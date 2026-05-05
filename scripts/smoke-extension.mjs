import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const CHROME_BIN = process.env.CHROME_BIN ?? "/usr/bin/google-chrome-stable";
const EXTENSION_DIR = process.cwd();
const CHATGPT_URL = "https://chatgpt.com/";
const PORT = 9400 + Math.floor(Math.random() * 400);
const HEADLESS = process.env.YACHT_HEADLESS === "1";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CdpClient {
  constructor(wsUrl, label) {
    this.wsUrl = wsUrl;
    this.label = label;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out connecting to ${this.label}`)), 5000);
      this.ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      this.ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error(`WebSocket failed for ${this.label}`));
      });
    });

    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);

      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);

        if (message.error) {
          reject(new Error(`${message.error.message}: ${message.error.data ?? ""}`));
        } else {
          resolve(message.result);
        }

        return;
      }

      const handlers = this.handlers.get(message.method) ?? [];
      for (const handler of handlers) {
        handler(message.params ?? {});
      }
    });
  }

  on(method, handler) {
    const handlers = this.handlers.get(method) ?? [];
    handlers.push(handler);
    this.handlers.set(method, handlers);
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(fn, ...args) {
    const expression = `(${fn})(${args.map((arg) => JSON.stringify(arg)).join(",")})`;
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? "Evaluation failed");
    }

    return result.result?.value;
  }

  close() {
    this.ws?.close();
  }
}

class PipeCdpClient {
  constructor(input, output) {
    this.input = input;
    this.output = output;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
  }

  connect() {
    this.output.on("data", (chunk) => {
      this.buffer += chunk.toString();
      const parts = this.buffer.split("\0");
      this.buffer = parts.pop() ?? "";

      for (const part of parts) {
        if (!part) {
          continue;
        }

        const message = JSON.parse(part);
        if (!message.id || !this.pending.has(message.id)) {
          continue;
        }

        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);

        if (message.error) {
          reject(new Error(`${message.error.message}: ${message.error.data ?? ""}`));
        } else {
          resolve(message.result);
        }
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.input.write(`${JSON.stringify({ id, method, params })}\0`);
    });
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }
  return response.json();
}

async function waitForCdp(port) {
  const versionUrl = `http://127.0.0.1:${port}/json/version`;

  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return await fetchJson(versionUrl);
    } catch {
      await sleep(125);
    }
  }

  throw new Error("Chrome DevTools endpoint did not start.");
}

async function getTargets(port) {
  return fetchJson(`http://127.0.0.1:${port}/json/list`);
}

async function waitForEval(client, fn, timeoutMs = 6000) {
  const startedAt = Date.now();
  let lastValue;

  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await client.evaluate(fn);
    if (lastValue) {
      return lastValue;
    }
    await sleep(120);
  }

  throw new Error(`Timed out waiting for condition. Last value: ${JSON.stringify(lastValue)}`);
}

async function openTarget(port, url) {
  return fetchJson(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT"
  });
}

async function loadUnpackedExtension(userDataDir) {
  const chrome = spawn(
    CHROME_BIN,
    [
      "--remote-debugging-pipe",
      "--enable-unsafe-extension-debugging",
      "--disable-gpu",
      "--disable-component-extensions-with-background-pages",
      "--no-sandbox",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${userDataDir}`,
      "about:blank"
    ],
    {
      stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"]
    }
  );

  let stderr = "";
  chrome.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const client = new PipeCdpClient(chrome.stdio[3], chrome.stdio[4]);
  client.connect();

  try {
    await client.send("Browser.getVersion");
    const result = await client.send("Extensions.loadUnpacked", {
      path: EXTENSION_DIR,
      enableInIncognito: false
    });
    await client.send("Browser.close").catch(() => {});
    await sleep(500);
    chrome.kill("SIGKILL");

    return {
      extensionId: result.id,
      stderr
    };
  } catch (error) {
    chrome.kill("SIGKILL");
    throw new Error(`Extensions.loadUnpacked failed: ${error.message}\n${stderr}`);
  }
}

function collectRuntimeDiagnostics(client, bucket) {
  client.on("Runtime.consoleAPICalled", (params) => {
    bucket.console.push({
      type: params.type,
      text: params.args?.map((arg) => arg.value ?? arg.description ?? "").join(" ")
    });
  });
  client.on("Runtime.exceptionThrown", (params) => {
    bucket.exceptions.push(params.exceptionDetails?.text ?? "Runtime exception");
  });
  client.on("Log.entryAdded", (params) => {
    bucket.logs.push({
      level: params.entry?.level,
      text: params.entry?.text
    });
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "yacht-chrome-"));
  const installResult = await loadUnpackedExtension(userDataDir);
  const chrome = spawn(
    CHROME_BIN,
    [
      ...(HEADLESS ? ["--headless=new"] : []),
      "--disable-gpu",
      "--disable-component-extensions-with-background-pages",
      "--enable-unsafe-extension-debugging",
      "--no-sandbox",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${userDataDir}`,
      "about:blank"
    ],
    {
      stdio: ["ignore", "ignore", "pipe"]
    }
  );

  let stderr = "";
  chrome.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const diagnostics = {
    page: { console: [], exceptions: [], logs: [] },
    serviceWorker: { console: [], exceptions: [], logs: [] },
    popup: { console: [], exceptions: [], logs: [] }
  };

  let page;
  let serviceWorker;
  let popup;

  try {
    await waitForCdp(PORT);
    const pageTarget = await openTarget(PORT, CHATGPT_URL);
    page = new CdpClient(pageTarget.webSocketDebuggerUrl, "chatgpt-page");
    await page.connect();
    collectRuntimeDiagnostics(page, diagnostics.page);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Log.enable");

    await sleep(4500);

    const livePage = await page.evaluate(() => ({
      href: window.location.href,
      title: document.title,
      readyState: document.readyState
    }));

    await page.evaluate(() => {
      document.body.innerHTML = `
        <style>
          #page-header {
            min-height: 56px;
            display: flex;
            justify-content: flex-end;
            align-items: center;
            padding: 8px 40px;
          }
          #conversation-header-actions {
            display: inline-flex;
            align-items: center;
            gap: 10px;
          }
        </style>
        <header id="page-header" data-fixed-header="less-than-xl">
          <div data-testid="thread-header-right-actions-container">
            <div data-testid="thread-header-right-actions">
              <div id="conversation-header-actions">
                <button data-testid="share-chat-button" type="button">Share</button>
                <button data-testid="conversation-options-button" aria-label="Open conversation options" type="button">...</button>
              </div>
            </div>
          </div>
        </header>
        <main id="thread">
          <section data-testid="conversation-turn-1" data-turn="assistant">
            <div data-message-author-role="assistant" data-message-id="assistant-source" data-turn-start-message="true">
              <p id="source-text">A careful source paragraph needs a <span id="source-split-a">driven </span><span id="source-split-b">plan</span> and a visible source link after Ask ChatGPT creates a subthread.</p>
            </div>
          </section>
        </main>
        <div id="thread-bottom-container">
          <div id="thread-bottom">
            <form>
              <div id="prompt-textarea" contenteditable="true" role="textbox" aria-label="Chat with ChatGPT"></div>
              <button id="composer-submit-button" data-testid="send-button" aria-label="Send prompt" type="button">Send</button>
            </form>
          </div>
        </div>`;
      return true;
    });

    try {
      await waitForEval(page, () => Boolean(document.querySelector(".yacht-header-controls")));
      await waitForEval(page, () => {
        const controls = document.querySelector(".yacht-header-controls");
        const share = document.querySelector('[data-testid="share-chat-button"]');
        if (!controls || !share) {
          return false;
        }

        const controlsRect = controls.getBoundingClientRect();
        const shareRect = share.getBoundingClientRect();
        const centered =
          Math.abs(
            controlsRect.top +
              controlsRect.height / 2 -
              (shareRect.top + shareRect.height / 2)
          ) <= 2;
        const leftOfShare = controlsRect.right <= shareRect.left - 4;

        return centered && leftOfShare
          ? {
              centered,
              leftOfShare,
              controlsRight: controlsRect.right,
              shareLeft: shareRect.left
            }
          : false;
      });

      await page.evaluate(() => {
        document.querySelector('[data-testid="share-chat-button"]').style.display = "none";
        const messageShare = document.createElement("button");
        messageShare.type = "button";
        messageShare.id = "message-action-share-fixture";
        messageShare.textContent = "Share";
        messageShare.style.marginTop = "24px";
        document.querySelector("#thread").append(messageShare);
        window.dispatchEvent(new Event("resize"));
      });
      await waitForEval(page, () => {
        const controls = document.querySelector(".yacht-header-controls");
        const options = document.querySelector('[data-testid="conversation-options-button"]');
        const messageShare = document.querySelector("#message-action-share-fixture");
        if (!controls || !options || !messageShare) {
          return false;
        }

        const controlsRect = controls.getBoundingClientRect();
        const optionsRect = options.getBoundingClientRect();
        const messageShareRect = messageShare.getBoundingClientRect();
        const centeredOnOptions =
          Math.abs(
            controlsRect.top +
              controlsRect.height / 2 -
              (optionsRect.top + optionsRect.height / 2)
          ) <= 2;
        const leftOfOptions = controlsRect.right <= optionsRect.left - 4;
        const notNearMessageShare =
          Math.abs(
            controlsRect.top +
              controlsRect.height / 2 -
              (messageShareRect.top + messageShareRect.height / 2)
          ) > 12;

        return centeredOnOptions && leftOfOptions && notNearMessageShare;
      });
      await page.evaluate(() => {
        document.querySelector('[data-testid="share-chat-button"]').style.display = "";
        document.querySelector("#message-action-share-fixture")?.remove();
        window.dispatchEvent(new Event("resize"));
      });
    } catch (error) {
      const debugState = await page.evaluate(() => ({
        href: window.location.href,
        title: document.title,
        readyState: document.readyState,
        hasFixtureHeader: Boolean(document.querySelector("#conversation-header-actions")),
        hasYachtControls: Boolean(document.querySelector(".yacht-header-controls")),
        placement: (() => {
          const controls = document.querySelector(".yacht-header-controls");
          const share = document.querySelector('[data-testid="share-chat-button"]');
          if (!controls || !share) {
            return null;
          }
          const controlsRect = controls.getBoundingClientRect();
          const shareRect = share.getBoundingClientRect();
          return {
            controls: {
              left: controlsRect.left,
              right: controlsRect.right,
              top: controlsRect.top,
              height: controlsRect.height
            },
            share: {
              left: shareRect.left,
              right: shareRect.right,
              top: shareRect.top,
              height: shareRect.height
            }
          };
        })(),
        diagnostic: document.querySelector(".yacht-diagnostic")?.textContent ?? null,
        bodyText: document.body?.innerText?.slice(0, 240) ?? ""
      }));
      const targets = await getTargets(PORT);
      throw new Error(
        `${error.message}\nDebug state: ${JSON.stringify(debugState, null, 2)}\nTargets: ${JSON.stringify(
          targets.map((target) => ({
            type: target.type,
            title: target.title,
            url: target.url
          })),
          null,
          2
        )}\nChrome stderr: ${stderr.slice(-4000)}`
      );
    }

    await page.evaluate(() => {
      const sourceStart = document.querySelector("#source-split-a").firstChild;
      const sourceEnd = document.querySelector("#source-split-b").firstChild;
      const range = document.createRange();
      range.setStart(sourceStart, 0);
      range.setEnd(sourceEnd, sourceEnd.nodeValue.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await sleep(180);

    await page.evaluate(() => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Ask ChatGPT";
      document.body.append(button);
      button.click();
      button.remove();
    });

    await page.evaluate(() => {
      document.querySelector("#thread").insertAdjacentHTML(
        "beforeend",
        `<section data-testid="conversation-turn-2" data-turn="user">
          <div data-message-author-role="user" data-message-id="user-root-1">
            <button type="button"><p class="line-clamp-3">driven plan</p></button>
            <div class="user-message-bubble-color">What does the driven plan imply?</div>
          </div>
        </section>
        <section data-testid="conversation-turn-3" data-turn="assistant">
          <div data-message-author-role="assistant" data-message-id="assistant-root-1" data-turn-start-message="true">
            <p>It implies the work should be broken into verifiable implementation steps.</p>
          </div>
        </section>`
      );
    });

    const firstThread = await waitForEval(page, () => {
      const turns = [...document.querySelectorAll('section[data-testid^="conversation-turn-"]')];
      const state = {
        sourceLinks: document.querySelectorAll(".yacht-source-link").length,
        overlay: Boolean(document.querySelector(".yacht-composer-overlay")),
        backHidden: document.querySelector('[data-yacht-control="back"]')?.hidden,
        hidden: turns.map((turn) => ({
          id: turn.dataset.testid,
          hidden: turn.classList.contains("yacht-hidden-turn")
        }))
      };

      return state.sourceLinks === 1 &&
        !state.overlay &&
        state.backHidden === false &&
        state.hidden[0]?.hidden === true
        ? state
        : false;
    });

    assert(
      firstThread.sourceLinks === 1,
      `Expected one rendered source link after first Ask mapping. State: ${JSON.stringify(
        firstThread
      )}. Console: ${JSON.stringify(diagnostics.page.console)}`
    );
    assert(!firstThread.overlay, `Expected composer to remain available in Subthread Mode. State: ${JSON.stringify(firstThread)}`);
    assert(firstThread.backHidden === false, `Expected header source button in Subthread Mode. State: ${JSON.stringify(firstThread)}`);
    assert(firstThread.hidden[0]?.hidden === true, `Expected original source turn hidden in Subthread Mode. State: ${JSON.stringify(firstThread)}`);

    const defaultSourceLinkStyle = await page.evaluate(() => {
      const link = document.querySelector(".yacht-source-link");
      const style = getComputedStyle(link);
      return {
        color: style.color,
        textDecorationLine: style.textDecorationLine,
        backgroundColor: style.backgroundColor,
        underlineDataset: link?.dataset.yachtUnderline
      };
    });
    assert(
      defaultSourceLinkStyle.color === "rgb(17, 17, 17)",
      `Expected default source link text color to apply. Style: ${JSON.stringify(defaultSourceLinkStyle)}`
    );
    assert(
      defaultSourceLinkStyle.textDecorationLine.includes("underline"),
      `Expected checked underline setting to render an underline. Style: ${JSON.stringify(defaultSourceLinkStyle)}`
    );
    assert(
      defaultSourceLinkStyle.backgroundColor === "rgba(0, 0, 0, 0)",
      `Expected source link to have no background tint by default. Style: ${JSON.stringify(defaultSourceLinkStyle)}`
    );

    await waitForEval(page, () => {
      const controls = document.querySelector(".yacht-header-controls");
      const share = document.querySelector('[data-testid="share-chat-button"]');
      const back = document.querySelector('[data-yacht-control="back"]');
      if (!controls || !share || back?.hidden !== false) {
        return false;
      }

      const controlsRect = controls.getBoundingClientRect();
      const shareRect = share.getBoundingClientRect();
      const centered =
        Math.abs(
          controlsRect.top +
            controlsRect.height / 2 -
            (shareRect.top + shareRect.height / 2)
        ) <= 2;
      const leftOfShare = controlsRect.right <= shareRect.left - 4;

      return centered && leftOfShare;
    });

    await page.evaluate(() => document.querySelector('[data-yacht-control="back"]').click());
    const returnedMain = await waitForEval(page, () => {
      const sourceTurn = document.querySelector('[data-testid="conversation-turn-1"]');
      const userTurn = document.querySelector('[data-testid="conversation-turn-2"]');
      const state = {
        sourceHidden: sourceTurn?.classList.contains("yacht-hidden-turn"),
        userHidden: userTurn?.classList.contains("yacht-hidden-turn"),
        sourceLinkText: document.querySelector(".yacht-source-link")?.textContent
      };

      return state.sourceHidden === false &&
        state.userHidden === true &&
        state.sourceLinkText === "driven plan"
        ? state
        : false;
    });

    assert(returnedMain.sourceHidden === false, "Expected source turn visible after return.");
    assert(returnedMain.userHidden === true, "Expected subthread user turn hidden in Main Mode.");
    assert(returnedMain.sourceLinkText === "driven plan", "Expected exact source link text.");

    const sourceLinkPointerDown = await page.evaluate(() => {
      const link = document.querySelector(".yacht-source-link");
      const rect = link.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;
      const event = new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
        button: 0,
        pointerId: 1,
        pointerType: "mouse"
      });
      const dispatched = link.dispatchEvent(event);

      return {
        defaultPrevented: event.defaultPrevented,
        dispatched,
        draggable: link.getAttribute("draggable"),
        userSelect: getComputedStyle(link).userSelect,
        backHidden: document.querySelector('[data-yacht-control="back"]')?.hidden
      };
    });
    assert(
      sourceLinkPointerDown.defaultPrevented === false &&
        sourceLinkPointerDown.dispatched === true &&
        sourceLinkPointerDown.draggable === "false" &&
        sourceLinkPointerDown.userSelect === "text" &&
        sourceLinkPointerDown.backHidden === true,
      `Expected source-link pointerdown to remain selectable without navigation. State: ${JSON.stringify(
        sourceLinkPointerDown
      )}`
    );

    const sourceLinkDragClick = await page.evaluate(() => {
      const link = document.querySelector(".yacht-source-link");
      const rect = link.getBoundingClientRect();
      const startX = rect.left + 2;
      const endX = rect.right - 2;
      const clientY = rect.top + rect.height / 2;
      link.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          clientX: startX,
          clientY,
          button: 0,
          pointerId: 1,
          pointerType: "mouse"
        })
      );
      link.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          clientX: endX,
          clientY,
          button: 0,
          pointerId: 1,
          pointerType: "mouse"
        })
      );

      const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
      const textNodes = [];
      while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
      }

      const range = document.createRange();
      range.setStart(textNodes.at(0), 0);
      range.setEnd(textNodes.at(-1), textNodes.at(-1).nodeValue.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);

      link.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          clientX: endX,
          clientY,
          button: 0,
          pointerId: 1,
          pointerType: "mouse"
        })
      );

      const click = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: endX,
        clientY,
        button: 0
      });
      const dispatched = link.dispatchEvent(click);
      const selectedText = selection.toString();
      selection.removeAllRanges();

      return {
        defaultPrevented: click.defaultPrevented,
        dispatched,
        selectedText,
        backHidden: document.querySelector('[data-yacht-control="back"]')?.hidden
      };
    });
    assert(
      sourceLinkDragClick.defaultPrevented === true &&
        sourceLinkDragClick.dispatched === false &&
        sourceLinkDragClick.selectedText === "driven plan" &&
        sourceLinkDragClick.backHidden === true,
      `Expected source-link drag selection click to be suppressed. State: ${JSON.stringify(
        sourceLinkDragClick
      )}`
    );

    const sourceLinkPointDragClick = await page.evaluate(() => {
      const link = document.querySelector(".yacht-source-link");
      const source = document.querySelector('[data-message-id="assistant-source"]');
      const rect = link.getBoundingClientRect();
      const startX = rect.left + 2;
      const endX = rect.right - 2;
      const clientY = rect.top + rect.height / 2;
      link.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          clientX: startX,
          clientY,
          button: 0,
          pointerId: 1,
          pointerType: "mouse"
        })
      );
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          clientX: endX,
          clientY,
          button: 0,
          pointerId: 1,
          pointerType: "mouse"
        })
      );
      document.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          clientX: endX,
          clientY,
          button: 0,
          pointerId: 1,
          pointerType: "mouse"
        })
      );

      const click = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: endX,
        clientY,
        button: 0
      });
      const dispatched = source.dispatchEvent(click);

      return {
        defaultPrevented: click.defaultPrevented,
        dispatched,
        backHidden: document.querySelector('[data-yacht-control="back"]')?.hidden
      };
    });
    assert(
      sourceLinkPointDragClick.defaultPrevented === true &&
        sourceLinkPointDragClick.dispatched === false &&
        sourceLinkPointDragClick.backHidden === true,
      `Expected point-based click after source-link drag to be suppressed. State: ${JSON.stringify(
        sourceLinkPointDragClick
      )}`
    );

    const outsideToSourceDragClick = await page.evaluate(() => {
      const link = document.querySelector(".yacht-source-link");
      const source = document.querySelector('[data-message-id="assistant-source"]');
      const linkRect = link.getBoundingClientRect();
      const sourceRect = source.getBoundingClientRect();
      const startX = Math.max(sourceRect.left + 2, linkRect.left - 16);
      const endX = linkRect.left + linkRect.width / 2;
      const clientY = linkRect.top + linkRect.height / 2;
      const startTarget = document.elementFromPoint(startX, clientY) ?? source;
      startTarget.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          clientX: startX,
          clientY,
          button: 0,
          pointerId: 1,
          pointerType: "mouse"
        })
      );
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          clientX: endX,
          clientY,
          button: 0,
          pointerId: 1,
          pointerType: "mouse"
        })
      );
      document.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          clientX: endX,
          clientY,
          button: 0,
          pointerId: 1,
          pointerType: "mouse"
        })
      );

      const click = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: endX,
        clientY,
        button: 0
      });
      const dispatched = link.dispatchEvent(click);

      return {
        defaultPrevented: click.defaultPrevented,
        dispatched,
        backHidden: document.querySelector('[data-yacht-control="back"]')?.hidden
      };
    });
    assert(
      outsideToSourceDragClick.defaultPrevented === true &&
        outsideToSourceDragClick.dispatched === false &&
        outsideToSourceDragClick.backHidden === true,
      `Expected outside-to-source drag click to be suppressed. State: ${JSON.stringify(
        outsideToSourceDragClick
      )}`
    );

    const sourceLinkPointerClick = await page.evaluate(() => {
      const link = document.querySelector(".yacht-source-link");
      const rect = link.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;
      link.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          button: 0,
          pointerId: 1,
          pointerType: "mouse"
        })
      );
      link.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          button: 0,
          pointerId: 1,
          pointerType: "mouse"
        })
      );
      const click = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
        button: 0
      });
      const dispatched = link.dispatchEvent(click);

      return {
        defaultPrevented: click.defaultPrevented,
        dispatched
      };
    });
    assert(
      sourceLinkPointerClick.defaultPrevented === true &&
        sourceLinkPointerClick.dispatched === false,
      `Expected source-link pointer click to activate navigation. State: ${JSON.stringify(
        sourceLinkPointerClick
      )}`
    );
    await waitForEval(page, () => document.querySelector('[data-yacht-control="back"]')?.hidden === false);
    await page.evaluate(() => document.querySelector('[data-yacht-control="back"]').click());
    await waitForEval(page, () => !document.querySelector('[data-testid="conversation-turn-1"]').classList.contains("yacht-hidden-turn"));

    await page.evaluate(() => {
      document.querySelectorAll(".yacht-source-link").forEach((wrapper) => {
        const parent = wrapper.parentNode;
        wrapper.replaceWith(...wrapper.childNodes);
        parent?.normalize();
      });

      const source = document.querySelector('[data-message-id="assistant-source"]');
      const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
      const textNodes = [];
      while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
      }
      const startNode = textNodes.find((node) => node.nodeValue?.includes("driven "));
      const endNode = textNodes.find((node) => node.nodeValue?.includes("plan"));
      const range = document.createRange();
      range.setStart(startNode, startNode.nodeValue.indexOf("driven "));
      range.setEnd(endNode, endNode.nodeValue.indexOf("plan") + "plan".length);
      const rect = range.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;
      const target = document.elementFromPoint(clientX, clientY);
      target.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          button: 0,
          pointerId: 1,
          pointerType: "mouse"
        })
      );
      target.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          button: 0,
          pointerId: 1,
          pointerType: "mouse"
        })
      );
      target.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          button: 0
        })
      );
    });
    await waitForEval(page, () => document.querySelector('[data-yacht-control="back"]')?.hidden === false);
    await page.evaluate(() => document.querySelector('[data-yacht-control="back"]').click());
    await waitForEval(page, () => !document.querySelector('[data-testid="conversation-turn-1"]').classList.contains("yacht-hidden-turn"));

    await page.evaluate(() => {
      const sourceText = document.querySelector(".yacht-source-link");
      const range = document.createRange();
      const walker = document.createTreeWalker(sourceText, NodeFilter.SHOW_TEXT);
      const textNodes = [];
      while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
      }
      range.setStart(textNodes.at(0), 0);
      range.setEnd(textNodes.at(-1), textNodes.at(-1).nodeValue.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await sleep(180);

    await page.evaluate(() => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Ask ChatGPT";
      document.body.append(button);
      button.click();
      button.remove();
      document.querySelector("#thread").insertAdjacentHTML(
        "beforeend",
        `<section data-testid="conversation-turn-4" data-turn="user">
          <div data-message-author-role="user" data-message-id="user-root-2">
            <button type="button"><p class="line-clamp-3">driven plan</p></button>
            <div class="user-message-bubble-color">Can this be a second question?</div>
          </div>
        </section>
        <section data-testid="conversation-turn-5" data-turn="assistant">
          <div data-message-author-role="assistant" data-message-id="assistant-root-2" data-turn-start-message="true">
            <p>Yes, the same source link can point to multiple independent questions.</p>
          </div>
        </section>`
      );
    });

    await waitForEval(page, () => {
      const back = document.querySelector('[data-yacht-control="back"]');
      return back && back.hidden === false;
    });
    await page.evaluate(() => document.querySelector('[data-yacht-control="back"]').click());
    await waitForEval(page, () => !document.querySelector('[data-testid="conversation-turn-1"]').classList.contains("yacht-hidden-turn"));

    await page.evaluate(() => {
      const source = document.querySelector('[data-message-id="assistant-source"]');
      const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
      const textNodes = [];
      while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
      }
      const plan = textNodes.find((node) => node.nodeValue?.includes("plan"));
      const afterPlan = textNodes.find((node) => node.nodeValue?.includes(" and a visible"));
      const range = document.createRange();
      range.setStart(plan, plan.nodeValue.indexOf("plan"));
      range.setEnd(afterPlan, afterPlan.nodeValue.indexOf(" visible") + " visible".length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await sleep(180);

    await page.evaluate(() => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Ask ChatGPT";
      document.body.append(button);
      button.click();
      button.remove();
      document.querySelector("#thread").insertAdjacentHTML(
        "beforeend",
        `<section data-testid="conversation-turn-6" data-turn="user">
          <div data-message-author-role="user" data-message-id="user-root-3">
            <button type="button"><p class="line-clamp-3">plan and a visible</p></button>
            <div class="user-message-bubble-color">How does the visible source relate?</div>
          </div>
        </section>
        <section data-testid="conversation-turn-7" data-turn="assistant">
          <div data-message-author-role="assistant" data-message-id="assistant-root-3" data-turn-start-message="true">
            <p>The overlapped source should still offer every related subthread.</p>
          </div>
        </section>`
      );
    });

    await waitForEval(page, () => {
      const back = document.querySelector('[data-yacht-control="back"]');
      return back && back.hidden === false;
    });
    await page.evaluate(() => document.querySelector('[data-yacht-control="back"]').click());
    await waitForEval(page, () => !document.querySelector('[data-testid="conversation-turn-1"]').classList.contains("yacht-hidden-turn"));

    await page.evaluate(() => {
      const source = document.querySelector('[data-message-id="assistant-source"]');
      const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
      const planNode = (() => {
        while (walker.nextNode()) {
          if (walker.currentNode.nodeValue?.includes("plan")) {
            return walker.currentNode;
          }
        }
        return null;
      })();
      const range = document.createRange();
      range.setStart(planNode, planNode.nodeValue.indexOf("plan"));
      range.setEnd(planNode, planNode.nodeValue.indexOf("plan") + "plan".length);
      const rect = range.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;
      const target = document.elementFromPoint(clientX, clientY) ?? source;
      target.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          button: 0
        })
      );
    });
    const chooser = await waitForEval(page, () => {
      const state = {
        items: document.querySelectorAll(".yacht-popover__item").length
      };
      return state.items === 3 ? state : false;
    });
    assert(chooser.items === 3, "Expected chooser with three threads across overlapping source anchors.");

    await page.evaluate(() => {
      const item = [...document.querySelectorAll(".yacht-popover__item")].find((button) =>
        button.textContent.includes("What does the driven plan imply?")
      );
      item.click();
    });
    await waitForEval(page, () => document.querySelector('[data-yacht-control="back"]')?.hidden === false);

    await page.evaluate(() => {
      const answer = document.querySelector('[data-message-id="assistant-root-1"] p').firstChild;
      const start = answer.nodeValue.indexOf("verifiable");
      const range = document.createRange();
      range.setStart(answer, start);
      range.setEnd(answer, start + "verifiable".length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await sleep(180);

    await page.evaluate(() => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Ask ChatGPT";
      document.body.append(button);
      button.click();
      button.remove();
      document.querySelector("#thread").insertAdjacentHTML(
        "beforeend",
        `<section data-testid="conversation-turn-8" data-turn="user">
          <div data-message-author-role="user" data-message-id="user-child-1">
            <button type="button"><p class="line-clamp-3">verifiable</p></button>
            <div class="user-message-bubble-color">What should be verified?</div>
          </div>
        </section>
        <section data-testid="conversation-turn-9" data-turn="assistant">
          <div data-message-author-role="assistant" data-message-id="assistant-child-1" data-turn-start-message="true">
            <p>The extension should verify navigation, hiding, source links, and storage restore.</p>
          </div>
        </section>`
      );
    });

    await waitForEval(page, () => {
      const childUser = document.querySelector('[data-testid="conversation-turn-8"]');
      const parentUser = document.querySelector('[data-testid="conversation-turn-2"]');
      const back = document.querySelector('[data-yacht-control="back"]');
      return (
        childUser &&
        parentUser &&
        !childUser.classList.contains("yacht-hidden-turn") &&
        parentUser.classList.contains("yacht-hidden-turn") &&
        back?.hidden === false
      );
    });

    await page.evaluate(() => document.querySelector('[data-yacht-control="back"]').click());
    let returnedParent;
    try {
      returnedParent = await waitForEval(page, () => {
        const state = {
          parentVisible: !document
            .querySelector('[data-testid="conversation-turn-2"]')
            .classList.contains("yacht-hidden-turn"),
          secondVisible: !document
            .querySelector('[data-testid="conversation-turn-4"]')
            .classList.contains("yacht-hidden-turn"),
          childHidden: document
            .querySelector('[data-testid="conversation-turn-8"]')
            .classList.contains("yacht-hidden-turn"),
          sourceVisible: !document
            .querySelector('[data-testid="conversation-turn-1"]')
            .classList.contains("yacht-hidden-turn"),
          backHidden: document.querySelector('[data-yacht-control="back"]')?.hidden
        };
        return state.parentVisible && state.childHidden ? state : false;
      });
    } catch (error) {
      const nestedState = await page.evaluate(() =>
        [...document.querySelectorAll('section[data-testid^="conversation-turn-"]')].map((turn) => ({
          id: turn.dataset.testid,
          text: turn.textContent.trim().slice(0, 80),
          hidden: turn.classList.contains("yacht-hidden-turn")
        }))
      );
      throw new Error(
        `${error.message}\nNested state: ${JSON.stringify(
          nestedState,
          null,
          2
        )}\nConsole: ${JSON.stringify(diagnostics.page.console)}`
      );
    }
    assert(returnedParent.parentVisible, "Expected child back to return to parent subthread.");
    assert(returnedParent.childHidden, "Expected child thread hidden after returning to parent.");

    let targets = await getTargets(PORT);
    let serviceWorkerTarget = targets.find(
      (target) =>
        target.type === "service_worker" &&
        target.url.includes(`chrome-extension://${installResult.extensionId}/`)
    );

    for (let attempt = 0; !serviceWorkerTarget && attempt < 20; attempt += 1) {
      await sleep(250);
      targets = await getTargets(PORT);
      serviceWorkerTarget = targets.find(
        (target) =>
          target.type === "service_worker" &&
          target.url.includes(`chrome-extension://${installResult.extensionId}/`)
      );
    }

    assert(serviceWorkerTarget, "Expected extension service worker target.");
    serviceWorker = new CdpClient(serviceWorkerTarget.webSocketDebuggerUrl, "service-worker");
    await serviceWorker.connect();
    collectRuntimeDiagnostics(serviceWorker, diagnostics.serviceWorker);
    await serviceWorker.send("Runtime.enable");
    const serviceWorkerInfo = await serviceWorker.evaluate(() => ({
      extensionId: chrome.runtime.id,
      hasIndexedDb: typeof indexedDB !== "undefined"
    }));
    assert(serviceWorkerInfo.hasIndexedDb, "Expected IndexedDB in the service worker.");

    const popupTarget = await openTarget(PORT, `chrome-extension://${installResult.extensionId}/src/popup/popup.html`);
    popup = new CdpClient(popupTarget.webSocketDebuggerUrl, "popup");
    await popup.connect();
    collectRuntimeDiagnostics(popup, diagnostics.popup);
    await popup.send("Runtime.enable");
    await popup.send("Log.enable");
    await waitForEval(popup, () => document.readyState === "complete" || document.readyState === "interactive");
    await waitForEval(
      popup,
      () =>
        document.querySelector("#link-underline")?.checked === true &&
        document.querySelector("#source-preview")?.dataset.underline === "true"
    );
    const popupState = await popup.evaluate(() => ({
      title: document.querySelector("h1")?.textContent,
      hasExport: Boolean(document.querySelector("#export-button")),
      hasImport: Boolean(document.querySelector("#import-button")),
      hasReset: Boolean(document.querySelector("#reset-button")),
      hasBackgroundTint: Boolean(document.querySelector("#link-background")),
      underlineChecked: document.querySelector("#link-underline")?.checked,
      previewUnderline: getComputedStyle(document.querySelector("#source-preview span"))
        .textDecorationLine
    }));
    assert(popupState.title === "YACHT Settings", "Expected popup title.");
    assert(popupState.hasExport && popupState.hasImport && popupState.hasReset, "Expected popup data controls.");
    assert(!popupState.hasBackgroundTint, "Expected popup Background tint setting to be removed.");
    assert(
      popupState.underlineChecked === true,
      `Expected underline setting to default checked. State: ${JSON.stringify(popupState)}`
    );
    assert(
      popupState.previewUnderline.includes("underline"),
      `Expected checked popup underline preview to show underline. State: ${JSON.stringify(popupState)}`
    );

    await popup.evaluate(() => {
      const color = document.querySelector("#link-color");
      const underline = document.querySelector("#link-underline");
      color.value = "#b91c1c";
      color.dispatchEvent(new Event("input", { bubbles: true }));
      underline.checked = false;
      underline.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await waitForEval(page, () => {
      const link = document.querySelector(".yacht-source-link");
      if (!link) {
        return false;
      }

      const style = getComputedStyle(link);
      const state = {
        color: style.color,
        textDecorationLine: style.textDecorationLine,
        backgroundColor: style.backgroundColor,
        underlineDataset: link.dataset.yachtUnderline
      };

      return state.color === "rgb(185, 28, 28)" &&
        state.textDecorationLine === "none" &&
        state.backgroundColor === "rgba(0, 0, 0, 0)" &&
        state.underlineDataset === "false"
        ? state
        : false;
    });

    await popup.evaluate(() => {
      const underline = document.querySelector("#link-underline");
      underline.checked = true;
      underline.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await waitForEval(page, () => {
      const link = document.querySelector(".yacht-source-link");
      if (!link) {
        return false;
      }

      const style = getComputedStyle(link);
      const state = {
        textDecorationLine: style.textDecorationLine,
        underlineDataset: link.dataset.yachtUnderline
      };

      return state.textDecorationLine.includes("underline") &&
        state.underlineDataset === "true"
        ? state
        : false;
    });

    await sleep(500);

    const importantPageErrors = diagnostics.page.console.filter(
      (entry) => entry.type === "error" && !entry.text.includes("[GSI_LOGGER]")
    );
    const importantPopupErrors = diagnostics.popup.console.filter((entry) => entry.type === "error");
    const importantWorkerErrors = diagnostics.serviceWorker.console.filter(
      (entry) => entry.type === "error"
    );

    assert(diagnostics.page.exceptions.length === 0, `Page exceptions: ${diagnostics.page.exceptions.join("; ")}`);
    assert(diagnostics.popup.exceptions.length === 0, `Popup exceptions: ${diagnostics.popup.exceptions.join("; ")}`);
    assert(
      diagnostics.serviceWorker.exceptions.length === 0,
      `Service worker exceptions: ${diagnostics.serviceWorker.exceptions.join("; ")}`
    );
    assert(importantPageErrors.length === 0, `Page console errors: ${JSON.stringify(importantPageErrors)}`);
    assert(importantPopupErrors.length === 0, `Popup console errors: ${JSON.stringify(importantPopupErrors)}`);
    assert(
      importantWorkerErrors.length === 0,
      `Service worker console errors: ${JSON.stringify(importantWorkerErrors)}`
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          extensionId: installResult.extensionId,
          livePage,
          checks: {
            headerControls: true,
            firstThreadMode: true,
            returnToSource: true,
            multipleThreadChooser: true,
            nestedBackNavigation: true,
            serviceWorker: true,
            popup: true,
            sourceLinkStyling: true,
            consoleErrors: 0
          }
        },
        null,
        2
      )
    );
  } finally {
    page?.close();
    serviceWorker?.close();
    popup?.close();
    chrome.kill("SIGTERM");
    await sleep(250);
    chrome.kill("SIGKILL");
    await rm(userDataDir, { recursive: true, force: true });

    if (process.exitCode && stderr) {
      console.error(stderr);
    }
  }
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
