const SETTINGS_KEY = "yacht.settings";
const NAV_KEY_PREFIX = "yacht.nav.";
const SCHEMA_VERSION = 1;
const HEADER_MOUNT_DELAY_MS = 2500;
const POST_RENDER_SCROLL_DELAYS_MS = [140, 280, 520, 900];

const SELECTORS = {
  header: "header#page-header",
  headerActions: "#conversation-header-actions",
  headerActionsFallback: '[data-testid="thread-header-right-actions"]',
  shareButton: '[data-testid="share-chat-button"]',
  optionsButton:
    '[data-testid="conversation-options-button"][aria-label="Open conversation options"]',
  turn: 'section[data-testid^="conversation-turn-"][data-turn]',
  message: "[data-message-author-role]",
  assistantMessage: '[data-message-author-role="assistant"]',
  userReferenceButton:
    '[data-message-author-role="user"] > button:has(> p.line-clamp-3)',
  repliedContent: 'button[aria-label="More about replied content"]',
  removeRepliedContent: 'button[aria-label="Remove"]',
  composerContainer: "#thread-bottom-container, #thread-bottom"
};

const DEFAULT_SETTINGS = {
  schemaVersion: SCHEMA_VERSION,
  enabled: true,
  sourceLinkStyle: {
    color: "#111111",
    underline: true
  }
};

const state = {
  initialized: false,
  conversationId: getConversationId(),
  settings: DEFAULT_SETTINGS,
  data: {
    anchors: [],
    threads: []
  },
  mode: "main",
  currentThreadId: null,
  pendingAsk: null,
  lastSelection: null,
  mutationObserver: null,
  routeTimer: null,
  renderTimer: null,
  renderingTimer: null,
  deferredMutationTimer: null,
  headerMountTimer: null,
  headerMountAllowedAt: Date.now() + HEADER_MOUNT_DELAY_MS,
  saveNavTimer: null,
  scrollTimers: [],
  scrollToken: 0,
  rendering: false,
  failSafe: false,
  diagnostic: "",
  repliedContentActive: false,
  suppressHeaderClickUntil: 0,
  suppressSourceClickUntil: 0
};

function isChatGptConversationUrl() {
  return /^\/c\/[^/?#]+/.test(window.location.pathname);
}

function getConversationId() {
  const match = window.location.pathname.match(/^\/c\/([^/?#]+)/);
  return match?.[1] ?? `page:${window.location.pathname}`;
}

function mergeSettings(settings = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    sourceLinkStyle: {
      ...DEFAULT_SETTINGS.sourceLinkStyle,
      ...(settings.sourceLinkStyle ?? {})
    },
    schemaVersion: SCHEMA_VERSION
  };
}

function normalizeText(text = "") {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeWithRawMap(text = "") {
  let normalized = "";
  const startMap = [];
  const endMap = [];
  let index = 0;

  while (index < text.length) {
    const char = text[index];

    if (/\s/.test(char)) {
      const whitespaceStart = index;
      while (index < text.length && /\s/.test(text[index])) {
        index += 1;
      }

      if (normalized.length > 0 && index < text.length) {
        normalized += " ";
        startMap.push(whitespaceStart);
        endMap.push(index);
      }
      continue;
    }

    normalized += char;
    startMap.push(index);
    endMap.push(index + 1);
    index += 1;
  }

  return { normalized, startMap, endMap };
}

function shortTitle(text = "") {
  const normalized = normalizeText(text);
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

function hashString(input = "") {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function createId(prefix) {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${prefix}_${id}`;
}

function nodeElement(node) {
  return node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement ?? null;
}

function textNodesUnder(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue) {
        return NodeFilter.FILTER_REJECT;
      }

      const parent = node.parentElement;

      if (
        parent?.closest(
          "script, style, textarea, button, .yacht-header-controls, .yacht-popover, .yacht-diagnostic, .yacht-composer-overlay"
        )
      ) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const nodes = [];
  while (walker.nextNode()) {
    nodes.push(walker.currentNode);
  }
  return nodes;
}

function textFromNodes(root) {
  return textNodesUnder(root)
    .map((node) => node.nodeValue)
    .join("");
}

function readTurnInfos() {
  return [...document.querySelectorAll(SELECTORS.turn)]
    .map((turn, index) => {
      const message =
        turn.querySelector("[data-message-author-role][data-message-id]") ??
        turn.querySelector(SELECTORS.message);
      const role =
        message?.getAttribute("data-message-author-role") ??
        turn.getAttribute("data-turn") ??
        "unknown";

      if (!message) {
        return null;
      }

      return {
        turn,
        message,
        role,
        index,
        messageId: message.getAttribute("data-message-id") ?? null,
        key: getMessageKey(message, role, index),
        text: normalizeText(message.textContent ?? "")
      };
    })
    .filter(Boolean);
}

function getMessageKey(message, role = "unknown", index = 0) {
  const messageId = message.getAttribute("data-message-id");

  if (messageId) {
    return `message:${messageId}`;
  }

  const text = normalizeText(message.textContent ?? "").slice(0, 160);
  return `fallback:${role}:${index}:${hashString(text)}`;
}

function getUserQuestionText(message) {
  const clone = message.cloneNode(true);
  clone
    .querySelectorAll("button:has(> p.line-clamp-3), .yacht-source-link")
    .forEach((node) => node.remove());
  return shortTitle(clone.textContent ?? "Ask ChatGPT follow-up");
}

function currentNavKey() {
  return `${NAV_KEY_PREFIX}${state.conversationId}`;
}

async function sendRuntime(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });

  if (!response?.ok) {
    throw new Error(response?.error ?? `Runtime message failed: ${type}`);
  }

  return response;
}

async function loadSettings() {
  const response = await sendRuntime("YACHT_GET_SETTINGS");
  state.settings = mergeSettings(response.settings);
}

async function loadConversationData() {
  const response = await sendRuntime("YACHT_GET_CONVERSATION_DATA", {
    conversationId: state.conversationId
  });

  state.data = {
    anchors: response.data?.anchors ?? [],
    threads: response.data?.threads ?? []
  };
}

async function loadNavigationState() {
  const stored = await chrome.storage.local.get({
    [currentNavKey()]: {
      mode: "main",
      currentThreadId: null
    }
  });
  const nav = stored[currentNavKey()];

  if (nav?.mode === "subthread" && findThread(nav.currentThreadId)) {
    state.mode = "subthread";
    state.currentThreadId = nav.currentThreadId;
    return;
  }

  state.mode = "main";
  state.currentThreadId = null;
}

function scheduleSaveNavigationState() {
  clearTimeout(state.saveNavTimer);
  state.saveNavTimer = setTimeout(() => {
    chrome.storage.local.set({
      [currentNavKey()]: {
        mode: state.mode,
        currentThreadId: state.currentThreadId
      }
    });
  }, 100);
}

function findAnchor(anchorId) {
  return state.data.anchors.find((anchor) => anchor.anchorId === anchorId) ?? null;
}

function findThread(threadId) {
  return state.data.threads.find((thread) => thread.threadId === threadId) ?? null;
}

function threadsForAnchor(anchorId) {
  return state.data.threads
    .filter((thread) => thread.anchorId === anchorId)
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
}

function allThreadMessageKeys() {
  const turns = readTurnInfos();
  const keys = new Set();

  for (const thread of state.data.threads) {
    for (const key of effectiveMessageKeysForThread(thread, turns)) {
      keys.add(key);
    }
  }

  return keys;
}

function deriveAssistantMessageKeys(thread, turns = readTurnInfos()) {
  const rootIndex = turns.findIndex((info) => info.key === thread.rootUserMessageKey);
  if (rootIndex < 0) {
    return thread.assistantMessageKeys ?? [];
  }

  const assistantKeys = [];
  for (const info of turns.slice(rootIndex + 1)) {
    if (info.role === "user") {
      break;
    }
    if (info.role === "assistant") {
      assistantKeys.push(info.key);
    }
  }

  return assistantKeys;
}

function effectiveMessageKeysForThread(thread, turns = readTurnInfos()) {
  const keys = new Set(thread.messageKeys ?? []);

  if (thread.rootUserMessageKey) {
    keys.add(thread.rootUserMessageKey);
  }

  for (const key of deriveAssistantMessageKeys(thread, turns)) {
    keys.add(key);
  }

  return keys;
}

function repairThreadMessageMappings(turns = readTurnInfos()) {
  for (const thread of state.data.threads) {
    const assistantMessageKeys = deriveAssistantMessageKeys(thread, turns);
    const messageKeys = [thread.rootUserMessageKey, ...assistantMessageKeys].filter(Boolean);
    const changed =
      messageKeys.join("|") !== (thread.messageKeys ?? []).join("|") ||
      assistantMessageKeys.join("|") !== (thread.assistantMessageKeys ?? []).join("|");

    if (!changed) {
      continue;
    }

    persistThread({
      ...thread,
      assistantMessageKeys,
      messageKeys,
      updatedAt: new Date().toISOString()
    }).catch((error) => console.error("[Yacht] failed to repair thread mapping", error));
  }
}

function setDiagnostic(message) {
  state.diagnostic = message;

  let diagnostic = document.querySelector(".yacht-diagnostic");
  if (!message) {
    diagnostic?.remove();
    return;
  }

  if (!diagnostic) {
    diagnostic = document.createElement("div");
    diagnostic.className = "yacht-diagnostic";
    diagnostic.setAttribute("role", "status");
    document.documentElement.append(diagnostic);
  }

  diagnostic.textContent = message;
}

function probeDom() {
  const hasConversationMessages = Boolean(document.querySelector(SELECTORS.message));
  const hasTurns = readTurnInfos().length > 0;

  if (state.settings.enabled && isChatGptConversationUrl() && hasConversationMessages && !hasTurns) {
    state.failSafe = true;
    setDiagnostic(
      "Ask Subthreads is in fail-safe mode because the ChatGPT message DOM was not recognized."
    );
    return;
  }

  state.failSafe = false;
  setDiagnostic("");
}

function applyStyleSettings() {
  const { color, underline } = state.settings.sourceLinkStyle;
  document.documentElement.style.setProperty("--yacht-link-color", color);
  document
    .querySelectorAll(".yacht-source-link")
    .forEach((node) => {
      node.dataset.yachtUnderline = String(Boolean(underline));
    });
}

function mountHeaderControls() {
  const remainingDelay = state.headerMountAllowedAt - Date.now();
  if (remainingDelay > 0) {
    clearTimeout(state.headerMountTimer);
    state.headerMountTimer = setTimeout(scheduleRender, remainingDelay);
    return;
  }

  const mountPoint = findHeaderMountPoint();
  if (!mountPoint) {
    return;
  }

  let root = document.querySelector(".yacht-header-controls");

  if (!root) {
    root = document.createElement("div");
    root.className = "yacht-header-controls";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "yacht-toggle";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-label", "Toggle Ask Subthreads");
    toggle.dataset.yachtControl = "toggle";

    const label = document.createElement("span");
    label.className = "yacht-sr-only";
    label.textContent = "Subthreads";

    const track = document.createElement("span");
    track.className = "yacht-toggle__track";
    track.setAttribute("aria-hidden", "true");

    toggle.append(label, track);

    const back = document.createElement("button");
    back.type = "button";
    back.className = "yacht-header-button";
    back.dataset.yachtControl = "back";
    back.setAttribute("aria-label", "Return to source");
    back.title = "Return to source";

    const backIcon = document.createElement("span");
    backIcon.className = "yacht-header-button__icon";
    backIcon.setAttribute("aria-hidden", "true");
    backIcon.textContent = "↩";
    back.append(backIcon);

    root.append(toggle, back);
  }

  const { parent, before } = mountPoint;

  if (!root.isConnected || root.parentElement !== parent || root.nextElementSibling !== before) {
    parent.insertBefore(root, before);
  }

  updateHeaderControls();
}

function updateHeaderControls() {
  const root = document.querySelector(".yacht-header-controls");
  if (!root) {
    return;
  }

  const toggle = root.querySelector('[data-yacht-control="toggle"]');
  const back = root.querySelector('[data-yacht-control="back"]');
  toggle?.setAttribute("aria-checked", String(Boolean(state.settings.enabled)));

  if (back) {
    back.hidden = !state.settings.enabled || state.mode !== "subthread" || !state.currentThreadId;
  }
}

function findHeaderMountPoint() {
  const header = document.querySelector(SELECTORS.header) ?? document;
  const parent =
    header.querySelector(SELECTORS.headerActions) ??
    header.querySelector(SELECTORS.headerActionsFallback);

  if (!parent) {
    return null;
  }

  const shareButton = parent.querySelector(SELECTORS.shareButton);
  const optionsButton = parent.querySelector(SELECTORS.optionsButton);

  if (isVisibleElement(shareButton)) {
    return { parent, before: shareButton };
  }

  if (isVisibleElement(optionsButton)) {
    return { parent, before: optionsButton };
  }

  return { parent, before: parent.firstChild };
}

function isVisibleElement(element) {
  if (!element) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

async function setEnabled(enabled) {
  state.settings = mergeSettings({
    ...state.settings,
    enabled
  });
  await sendRuntime("YACHT_SAVE_SETTINGS", { settings: state.settings });

  if (!enabled) {
    state.mode = "main";
    state.currentThreadId = null;
    scheduleSaveNavigationState();
  }

  scheduleRender();
}

function captureSelection() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return;
  }

  const range = selection.getRangeAt(0);
  const startMessage = nodeElement(range.startContainer)?.closest(
    '[data-message-author-role="assistant"][data-message-id]'
  );
  const endMessage = nodeElement(range.endContainer)?.closest(
    '[data-message-author-role="assistant"][data-message-id]'
  );

  if (!startMessage || startMessage !== endMessage) {
    return;
  }

  const selectedText = range.toString();
  if (normalizeText(selectedText).length < 2) {
    return;
  }

  const offsets = offsetsForRange(startMessage, range);
  if (!offsets) {
    return;
  }

  const fullText = textFromNodes(startMessage);
  const turnInfo = readTurnInfos().find((info) => info.message === startMessage);

  state.lastSelection = {
    selectedText: normalizeText(selectedText),
    sourceMessageId: startMessage.getAttribute("data-message-id") ?? null,
    sourceMessageKey:
      turnInfo?.key ?? getMessageKey(startMessage, "assistant", turnInfo?.index ?? 0),
    sourceRole: "assistant",
    startOffset: offsets.start,
    endOffset: offsets.end,
    prefixText: fullText.slice(Math.max(0, offsets.start - 50), offsets.start),
    suffixText: fullText.slice(offsets.end, offsets.end + 50),
    sourceHash: hashString(normalizeText(fullText)),
    capturedAt: new Date().toISOString()
  };
}

function offsetsForRange(root, range) {
  const nodes = textNodesUnder(root);
  let seen = 0;
  let start = null;
  let end = null;

  for (const node of nodes) {
    const next = seen + node.nodeValue.length;

    if (node === range.startContainer) {
      start = seen + range.startOffset;
    }

    if (node === range.endContainer) {
      end = seen + range.endOffset;
      break;
    }

    seen = next;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    return null;
  }

  return { start, end };
}

function findExistingAnchor(selection) {
  return (
    state.data.anchors.find((anchor) => {
      const sameMessage = anchor.sourceMessageKey === selection.sourceMessageKey;
      const sameText = normalizeText(anchor.selectedText) === selection.selectedText;
      const closeOffsets =
        Math.abs(Number(anchor.startOffset) - selection.startOffset) <= 2 &&
        Math.abs(Number(anchor.endOffset) - selection.endOffset) <= 2;
      return sameMessage && sameText && closeOffsets;
    }) ?? null
  );
}

function buildAnchorFromSelection(selection) {
  const existing = findExistingAnchor(selection);

  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    anchorId: createId("anchor"),
    conversationId: state.conversationId,
    sourceMessageKey: selection.sourceMessageKey,
    sourceMessageId: selection.sourceMessageId,
    sourceRole: selection.sourceRole,
    selectedText: selection.selectedText,
    prefixText: selection.prefixText,
    suffixText: selection.suffixText,
    startOffset: selection.startOffset,
    endOffset: selection.endOffset,
    sourceHash: selection.sourceHash,
    createdAt: now,
    updatedAt: now
  };
}

function createPendingAsk(trigger) {
  if (!state.settings.enabled || state.failSafe || !state.lastSelection) {
    return;
  }

  const anchor = buildAnchorFromSelection(state.lastSelection);
  state.pendingAsk = {
    anchor,
    parentThreadId: state.mode === "subthread" ? state.currentThreadId : null,
    baselineKeys: new Set(readTurnInfos().map((info) => info.key)),
    createdAt: Date.now(),
    trigger,
    threadId: null,
    rootUserMessageKey: null
  };

  schedulePendingReconcile();
}

async function persistAnchor(anchor) {
  const existingIndex = state.data.anchors.findIndex(
    (record) => record.anchorId === anchor.anchorId
  );

  if (existingIndex >= 0) {
    state.data.anchors[existingIndex] = anchor;
  } else {
    state.data.anchors.push(anchor);
  }

  await sendRuntime("YACHT_UPSERT_ANCHOR", { anchor });
}

async function persistThread(thread) {
  const existingIndex = state.data.threads.findIndex(
    (record) => record.threadId === thread.threadId
  );

  if (existingIndex >= 0) {
    state.data.threads[existingIndex] = thread;
  } else {
    state.data.threads.push(thread);
  }

  await sendRuntime("YACHT_UPSERT_THREAD", { thread });
}

function reconcilePendingAsk() {
  if (!state.pendingAsk) {
    return;
  }

  const pending = state.pendingAsk;
  const turns = readTurnInfos();

  if (!pending.rootUserMessageKey) {
    const userTurn = turns.find(
      (info) => info.role === "user" && !pending.baselineKeys.has(info.key)
    );

    if (!userTurn) {
      if (
        !document.querySelector(SELECTORS.repliedContent) &&
        Date.now() - pending.createdAt > 5000
      ) {
        state.pendingAsk = null;
      }
      return;
    }

    const now = new Date().toISOString();
    const thread = {
      schemaVersion: SCHEMA_VERSION,
      threadId: createId("thread"),
      conversationId: state.conversationId,
      anchorId: pending.anchor.anchorId,
      parentThreadId: pending.parentThreadId,
      rootQuestionTitle: getUserQuestionText(userTurn.message),
      rootUserMessageKey: userTurn.key,
      assistantMessageKeys: [],
      messageKeys: [userTurn.key],
      createdAt: now,
      updatedAt: now
    };

    pending.threadId = thread.threadId;
    pending.rootUserMessageKey = userTurn.key;

    Promise.all([persistAnchor(pending.anchor), persistThread(thread)])
      .then(() => {
        navigateToThread(thread.threadId);
      })
      .catch((error) => {
        console.error("[Yacht] failed to persist new Ask thread", error);
      });
  }

  if (!pending.threadId || !pending.rootUserMessageKey) {
    return;
  }

  const thread = findThread(pending.threadId);
  const rootIndex = turns.findIndex((info) => info.key === pending.rootUserMessageKey);
  if (!thread || rootIndex < 0) {
    return;
  }

  const assistantMessageKeys = [];
  for (const info of turns.slice(rootIndex + 1)) {
    if (info.role === "user") {
      break;
    }
    if (info.role === "assistant") {
      assistantMessageKeys.push(info.key);
    }
  }

  const nextMessageKeys = [thread.rootUserMessageKey, ...assistantMessageKeys];
  const changed =
    nextMessageKeys.join("|") !== (thread.messageKeys ?? []).join("|") ||
    assistantMessageKeys.join("|") !== (thread.assistantMessageKeys ?? []).join("|");

  if (changed) {
    thread.assistantMessageKeys = assistantMessageKeys;
    thread.messageKeys = nextMessageKeys;
    thread.updatedAt = new Date().toISOString();
    persistThread(thread)
      .then(scheduleRender)
      .catch((error) => console.error("[Yacht] failed to update Ask thread", error));
  }

  if (assistantMessageKeys.length > 0) {
    state.pendingAsk = null;
  }
}

function schedulePendingReconcile() {
  window.setTimeout(reconcilePendingAsk, 200);
  window.setTimeout(reconcilePendingAsk, 900);
  window.setTimeout(reconcilePendingAsk, 2200);
}

function isAskButtonLike(button) {
  const label = normalizeText(
    `${button.getAttribute("aria-label") ?? ""} ${button.title ?? ""} ${
      button.textContent ?? ""
    }`
  ).toLowerCase();

  return label.includes("ask chatgpt") || label === "ask";
}

function handleDocumentPointerDown(event) {
  if (event.button !== 0) {
    return;
  }

  const headerControl = headerControlFromEvent(event);
  if (headerControl) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    state.suppressHeaderClickUntil = Date.now() + 600;
    activateHeaderControl(headerControl);
    return;
  }

  if (!state.settings.enabled || state.failSafe) {
    return;
  }

  const anchor = sourceAnchorFromEvent(event);
  if (!anchor) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  state.suppressSourceClickUntil = Date.now() + 600;
  openAnchor(anchor.anchorId, event);
}

function handleDocumentClick(event) {
  const target = nodeElement(event.target);
  if (!target) {
    return;
  }

  const headerControl = target.closest(".yacht-header-controls [data-yacht-control]");
  if (headerControl) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    if (Date.now() < state.suppressHeaderClickUntil) {
      return;
    }
    activateHeaderControl(headerControl);
    return;
  }

  const sourceLink = target.closest(".yacht-source-link");
  if (sourceLink) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    if (Date.now() < state.suppressSourceClickUntil) {
      return;
    }
    openAnchor(sourceLink.dataset.anchorId, event);
    return;
  }

  const clickedAnchor = sourceAnchorFromEvent(event);
  if (clickedAnchor) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    if (Date.now() < state.suppressSourceClickUntil) {
      return;
    }
    openAnchor(clickedAnchor.anchorId, event);
    return;
  }

  if (!target.closest(".yacht-popover")) {
    closeThreadChooser();
  }

  const referenceButton = target.closest(SELECTORS.userReferenceButton);
  if (
    referenceButton &&
    state.settings.enabled &&
    state.mode === "subthread" &&
    state.currentThreadId
  ) {
    event.preventDefault();
    event.stopPropagation();
    returnToSource();
    return;
  }

  const removeButton = target.closest(SELECTORS.removeRepliedContent);
  if (removeButton && state.pendingAsk) {
    state.pendingAsk = null;
    return;
  }

  const clickedButton = target.closest("button");
  if (clickedButton && state.lastSelection && isAskButtonLike(clickedButton)) {
    createPendingAsk("ask-button-click");
  }
}

function headerControlFromEvent(event) {
  const target = nodeElement(event.target);
  return target?.closest?.(".yacht-header-controls [data-yacht-control]") ?? null;
}

function activateHeaderControl(control) {
  const controlName = control?.dataset?.yachtControl;

  if (controlName === "toggle") {
    setEnabled(!state.settings.enabled).catch((error) => {
      console.error("[Yacht] failed to toggle header control", error);
    });
    return true;
  }

  if (controlName === "back" && state.settings.enabled && state.mode === "subthread") {
    returnToSource();
    return true;
  }

  return false;
}

function sourceAnchorFromEvent(event) {
  if (!state.settings.enabled || state.failSafe) {
    return null;
  }

  const target = nodeElement(event.target);
  const sourceLink = target?.closest?.(".yacht-source-link");
  if (sourceLink) {
    return findAnchor(sourceLink.dataset.anchorId);
  }

  if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
    return null;
  }

  return findAnchorAtPoint(event.clientX, event.clientY);
}

function openAnchor(anchorId, event) {
  const threads = threadsForAnchor(anchorId);

  if (threads.length === 0) {
    return;
  }

  if (threads.length === 1) {
    navigateToThread(threads[0].threadId);
    return;
  }

  showThreadChooser(anchorId, event);
}

function showThreadChooser(anchorId, event) {
  closeThreadChooser();
  const threads = threadsForAnchor(anchorId);
  const popover = document.createElement("div");
  popover.className = "yacht-popover";
  popover.setAttribute("role", "menu");

  for (const thread of threads) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "yacht-popover__item";
    item.setAttribute("role", "menuitem");

    const title = document.createElement("span");
    title.className = "yacht-popover__title";
    title.textContent = shortTitle(thread.rootQuestionTitle || "Ask ChatGPT follow-up");

    const time = document.createElement("span");
    time.className = "yacht-popover__time";
    time.textContent = formatDate(thread.createdAt);

    item.append(title, time);
    item.addEventListener("click", () => {
      closeThreadChooser();
      navigateToThread(thread.threadId);
    });
    popover.append(item);
  }

  document.documentElement.append(popover);
  const width = 340;
  const left = Math.min(event.clientX, window.innerWidth - width - 12);
  const top = Math.min(event.clientY + 8, window.innerHeight - 300);
  popover.style.left = `${Math.max(12, left)}px`;
  popover.style.top = `${Math.max(12, top)}px`;
}

function closeThreadChooser() {
  document.querySelector(".yacht-popover")?.remove();
}

function formatDate(value) {
  if (!value) {
    return "";
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function navigateToThread(threadId) {
  if (!findThread(threadId)) {
    return;
  }

  state.mode = "subthread";
  state.currentThreadId = threadId;
  scheduleSaveNavigationState();
  scheduleRender();
  queueScrollToThread(threadId);
}

function returnToSource() {
  const thread = findThread(state.currentThreadId);
  if (!thread) {
    state.mode = "main";
    state.currentThreadId = null;
    scheduleSaveNavigationState();
    scheduleRender();
    return;
  }

  const anchor = findAnchor(thread.anchorId);
  const parent = findDirectParentThread(thread, anchor);

  if (parent) {
    state.mode = "subthread";
    state.currentThreadId = parent.threadId;
  } else {
    state.mode = "main";
    state.currentThreadId = null;
  }

  scheduleSaveNavigationState();
  scheduleRender();
  queueScrollToAnchor(anchor?.anchorId ?? thread.anchorId);
}

function findDirectParentThread(thread, anchor) {
  const explicitParent = findThread(thread.parentThreadId);
  if (explicitParent) {
    return explicitParent;
  }

  if (!anchor?.sourceMessageKey) {
    return null;
  }

  return (
    state.data.threads.find(
      (candidate) =>
        candidate.threadId !== thread.threadId &&
        (candidate.messageKeys ?? []).includes(anchor.sourceMessageKey)
    ) ?? null
  );
}

function scrollToThread(threadId) {
  scrollTargetIntoView(findThreadScrollTarget(threadId));
}

function scrollToAnchor(anchorId) {
  scrollTargetIntoView(findAnchorScrollTarget(anchorId));
}

function queueScrollToThread(threadId) {
  queuePostRenderScroll(() => findThreadScrollTarget(threadId));
}

function queueScrollToAnchor(anchorId) {
  queuePostRenderScroll(() => findAnchorScrollTarget(anchorId));
}

function queuePostRenderScroll(resolveTarget) {
  clearQueuedScroll();
  const token = state.scrollToken + 1;
  state.scrollToken = token;

  POST_RENDER_SCROLL_DELAYS_MS.forEach((delay, index) => {
    const timer = setTimeout(() => {
      if (token !== state.scrollToken) {
        return;
      }

      requestAnimationFrame(() => {
        if (token !== state.scrollToken) {
          return;
        }

        const target = resolveTarget();
        if (!target) {
          scheduleRender();
          return;
        }

        scrollTargetIntoView(target, index === 0 ? "smooth" : "auto");

        if (isScrollTargetInView(target)) {
          clearQueuedScroll();
        }
      });
    }, delay);

    state.scrollTimers.push(timer);
  });
}

function clearQueuedScroll() {
  for (const timer of state.scrollTimers) {
    clearTimeout(timer);
  }

  state.scrollTimers = [];
}

function findThreadScrollTarget(threadId) {
  const thread = findThread(threadId);
  const firstKey = thread?.messageKeys?.[0];
  if (!firstKey) {
    return null;
  }

  const turn = readTurnInfos().find((info) => info.key === firstKey)?.turn ?? null;
  return isVisibleScrollTarget(turn) ? turn : null;
}

function findAnchorScrollTarget(anchorId) {
  if (!anchorId) {
    return null;
  }

  const links = [...document.querySelectorAll(
    `.yacht-source-link[data-anchor-id="${CSS.escape(anchorId)}"]`
  )];
  const link = links.find(isVisibleScrollTarget);

  if (link) {
    return link;
  }

  const anchor = findAnchor(anchorId);
  const message = anchor ? findSourceMessage(anchor) : null;
  return isVisibleScrollTarget(message) ? message : null;
}

function scrollTargetIntoView(target, behavior = "smooth") {
  if (!target) {
    return;
  }

  target.scrollIntoView({
    block: "center",
    inline: "nearest",
    behavior
  });
}

function isVisibleScrollTarget(target) {
  if (!target?.isConnected || target.closest(".yacht-hidden-turn")) {
    return false;
  }

  const rect = target.getBoundingClientRect();
  const style = getComputedStyle(target);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden"
  );
}

function isScrollTargetInView(target) {
  if (!isVisibleScrollTarget(target)) {
    return false;
  }

  const rect = target.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const center = rect.top + rect.height / 2;
  return center >= viewportHeight * 0.2 && center <= viewportHeight * 0.8;
}

function clearSourceLinks() {
  const wrappers = [...document.querySelectorAll(".yacht-source-link")];
  for (const wrapper of wrappers) {
    const parent = wrapper.parentNode;
    wrapper.replaceWith(...wrapper.childNodes);
    parent?.normalize();
  }
}

function findSourceMessage(anchor) {
  if (anchor.sourceMessageId) {
    const byId = document.querySelector(
      `[data-message-id="${CSS.escape(anchor.sourceMessageId)}"]`
    );
    if (byId) {
      return byId;
    }
  }

  return (
    readTurnInfos().find((info) => info.key === anchor.sourceMessageKey)?.message ?? null
  );
}

function restoreAnchorRange(anchor) {
  const message = findSourceMessage(anchor);
  if (!message) {
    return null;
  }

  const fullText = textFromNodes(message);
  const selected = normalizeText(anchor.selectedText);
  const startOffset = Number(anchor.startOffset);
  const endOffset = Number(anchor.endOffset);

  if (
    Number.isFinite(startOffset) &&
    Number.isFinite(endOffset) &&
    startOffset >= 0 &&
    endOffset <= fullText.length &&
    normalizeText(fullText.slice(startOffset, endOffset)) === selected
  ) {
    return {
      message,
      startOffset,
      endOffset,
      confidence: 1
    };
  }

  const candidate = findRangeByTextContext(fullText, anchor);
  if (candidate.confidence >= 0.7) {
    return {
      message,
      ...candidate
    };
  }

  return null;
}

function findRangeByTextContext(fullText, anchor) {
  const selected = normalizeText(anchor.selectedText ?? "");
  const normalizedFullText = normalizeWithRawMap(fullText);
  const matches = [];
  let index = normalizedFullText.normalized.indexOf(selected);

  while (index >= 0) {
    matches.push(index);
    index = normalizedFullText.normalized.indexOf(selected, index + Math.max(1, selected.length));
  }

  if (matches.length === 0) {
    return { confidence: 0 };
  }

  let best = null;
  const normalizedPrefix = normalizeText(anchor.prefixText ?? "");
  const normalizedSuffix = normalizeText(anchor.suffixText ?? "");
  const expectedStartOffset = Number(anchor.startOffset);

  for (const normalizedStartOffset of matches) {
    const normalizedEndOffset = normalizedStartOffset + selected.length;
    const startOffset = normalizedFullText.startMap[normalizedStartOffset];
    const endOffset = normalizedFullText.endMap[normalizedEndOffset - 1];

    if (!Number.isFinite(startOffset) || !Number.isFinite(endOffset)) {
      continue;
    }

    let score = 0.45;

    if (matches.length === 1) {
      score += 0.2;
    }

    if (Number.isFinite(expectedStartOffset) && Math.abs(startOffset - expectedStartOffset) <= 48) {
      score += 0.2;
    }

    const prefix = normalizedFullText.normalized.slice(
      Math.max(0, normalizedStartOffset - Math.max(50, normalizedPrefix.length)),
      normalizedStartOffset
    );
    const suffix = normalizedFullText.normalized.slice(
      normalizedEndOffset,
      normalizedEndOffset + Math.max(50, normalizedSuffix.length)
    );

    if (normalizedPrefix && prefix.endsWith(normalizedPrefix.slice(-20))) {
      score += 0.18;
    }

    if (normalizedSuffix && suffix.startsWith(normalizedSuffix.slice(0, 20))) {
      score += 0.18;
    }

    if (!best || score > best.confidence) {
      best = { startOffset, endOffset, confidence: score };
    }
  }

  return best ?? { confidence: 0 };
}

function rangeFromTextOffsets(root, startOffset, endOffset) {
  const nodes = textNodesUnder(root);
  let seen = 0;
  let startNode = null;
  let startInNode = 0;
  let endNode = null;
  let endInNode = 0;

  for (const node of nodes) {
    const next = seen + node.nodeValue.length;

    if (!startNode && startOffset >= seen && startOffset <= next) {
      startNode = node;
      startInNode = startOffset - seen;
    }

    if (!endNode && endOffset >= seen && endOffset <= next) {
      endNode = node;
      endInNode = endOffset - seen;
      break;
    }

    seen = next;
  }

  if (!startNode || !endNode) {
    return null;
  }

  const range = document.createRange();
  range.setStart(startNode, startInNode);
  range.setEnd(endNode, endInNode);
  return range;
}

function findAnchorAtPoint(clientX, clientY) {
  if (!state.settings.enabled || state.failSafe) {
    return null;
  }

  for (const link of document.querySelectorAll(".yacht-source-link")) {
    if (pointInsideRects(clientX, clientY, link.getClientRects(), 3)) {
      return findAnchor(link.dataset.anchorId);
    }
  }

  for (const anchor of state.data.anchors) {
    if (threadsForAnchor(anchor.anchorId).length === 0) {
      continue;
    }

    const restored = restoreAnchorRange(anchor);
    if (!restored) {
      continue;
    }

    const range = rangeFromTextOffsets(
      restored.message,
      restored.startOffset,
      restored.endOffset
    );

    if (range && pointInsideRects(clientX, clientY, range.getClientRects(), 3)) {
      return anchor;
    }
  }

  return null;
}

function pointInsideRects(clientX, clientY, rects, padding = 0) {
  return [...rects].some(
    (rect) =>
      clientX >= rect.left - padding &&
      clientX <= rect.right + padding &&
      clientY >= rect.top - padding &&
      clientY <= rect.bottom + padding
  );
}

function wrapTextOffsets(root, startOffset, endOffset, anchor) {
  const nodes = textNodesUnder(root);
  let seen = 0;
  let wrapped = false;

  for (const node of nodes) {
    const next = seen + node.nodeValue.length;
    const segmentStart = Math.max(startOffset, seen);
    const segmentEnd = Math.min(endOffset, next);

    if (segmentStart < segmentEnd) {
      const range = document.createRange();
      range.setStart(node, segmentStart - seen);
      range.setEnd(node, segmentEnd - seen);

      const link = document.createElement("a");
      link.href = "#";
      link.className = "yacht-source-link";
      link.dataset.anchorId = anchor.anchorId;
      link.dataset.yachtUnderline = String(Boolean(state.settings.sourceLinkStyle.underline));
      link.title = "Open Ask ChatGPT subthread";
      link.setAttribute("role", "link");

      range.surroundContents(link);
      wrapped = true;
    }

    seen = next;

    if (seen >= endOffset) {
      break;
    }
  }

  return wrapped;
}

function applySourceLinks() {
  clearSourceLinks();

  if (!state.settings.enabled || state.failSafe) {
    return;
  }

  const sortedAnchors = [...state.data.anchors]
    .filter((anchor) => threadsForAnchor(anchor.anchorId).length > 0)
    .sort((left, right) => {
      const source = String(right.sourceMessageKey).localeCompare(String(left.sourceMessageKey));
      return source || Number(right.startOffset) - Number(left.startOffset);
    });

  let skipped = 0;

  for (const anchor of sortedAnchors) {
    const restored = restoreAnchorRange(anchor);
    if (!restored) {
      skipped += 1;
      continue;
    }

    try {
      wrapTextOffsets(restored.message, restored.startOffset, restored.endOffset, anchor);
    } catch (error) {
      skipped += 1;
      console.warn("[Yacht] failed to render source link", anchor.anchorId, error);
    }
  }

  if (skipped > 0) {
    console.debug(`[Yacht] skipped ${skipped} source link(s) with low restore confidence.`);
  }
}

function applyMessageVisibility() {
  const turns = readTurnInfos();
  repairThreadMessageMappings(turns);
  const hiddenKeys = allThreadMessageKeys();
  const currentThread = findThread(state.currentThreadId);
  const currentKeys = currentThread
    ? effectiveMessageKeysForThread(currentThread, turns)
    : new Set();

  for (const info of turns) {
    let hidden = false;

    if (state.settings.enabled && !state.failSafe && state.mode === "main") {
      hidden = hiddenKeys.has(info.key);
    }

    if (state.settings.enabled && !state.failSafe && state.mode === "subthread") {
      hidden = !currentKeys.has(info.key);
    }

    info.turn.classList.toggle("yacht-hidden-turn", hidden);
  }
}

function clearMessageVisibility() {
  document
    .querySelectorAll(".yacht-hidden-turn")
    .forEach((turn) => turn.classList.remove("yacht-hidden-turn"));
}

function ensureComposerOverlay() {
  const container = document.querySelector(SELECTORS.composerContainer);
  if (!container) {
    return;
  }

  if (getComputedStyle(container).position === "static") {
    container.dataset.yachtOriginalPosition = container.style.position;
    container.style.position = "relative";
  }

  if (container.querySelector(".yacht-composer-overlay")) {
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "yacht-composer-overlay";
  overlay.innerHTML =
    '<div class="yacht-composer-overlay__message">This subthread is read-only.<br>Return to the original text, or select text in the currently visible answer to start a new Ask ChatGPT.</div>';
  container.append(overlay);
}

function removeComposerOverlay() {
  document.querySelectorAll(".yacht-composer-overlay").forEach((node) => node.remove());
  document.querySelectorAll("[data-yacht-original-position]").forEach((node) => {
    node.style.position = node.dataset.yachtOriginalPosition;
    delete node.dataset.yachtOriginalPosition;
  });
}

function applyComposerOverlay() {
  if (
    state.settings.enabled &&
    !state.failSafe &&
    state.mode === "subthread" &&
    !state.repliedContentActive
  ) {
    ensureComposerOverlay();
    return;
  }

  removeComposerOverlay();
}

function restoreOriginalRendering() {
  clearSourceLinks();
  clearMessageVisibility();
  removeComposerOverlay();
  closeThreadChooser();
}

function refreshRepliedContentState() {
  const wasActive = state.repliedContentActive;
  state.repliedContentActive = Boolean(document.querySelector(SELECTORS.repliedContent));

  if (state.repliedContentActive && state.lastSelection && !state.pendingAsk) {
    createPendingAsk("replied-content");
  }

  if (wasActive !== state.repliedContentActive) {
    scheduleRender();
  }
}

function scheduleRender() {
  clearTimeout(state.renderTimer);
  state.renderTimer = setTimeout(render, 90);
}

function render() {
  state.rendering = true;
  clearTimeout(state.renderingTimer);

  try {
    probeDom();
    applyStyleSettings();
    mountHeaderControls();
    updateHeaderControls();

    if (!state.settings.enabled || state.failSafe) {
      restoreOriginalRendering();
      return;
    }

    applySourceLinks();
    applyMessageVisibility();
    applyComposerOverlay();
  } finally {
    state.renderingTimer = setTimeout(() => {
      state.rendering = false;
    }, 60);
  }
}

function handleMutation() {
  if (state.rendering) {
    clearTimeout(state.deferredMutationTimer);
    state.deferredMutationTimer = setTimeout(() => {
      refreshRepliedContentState();
      reconcilePendingAsk();
      scheduleRender();
    }, 90);
    return;
  }

  refreshRepliedContentState();
  reconcilePendingAsk();
  scheduleRender();
}

function observeDom() {
  state.mutationObserver?.disconnect();
  state.mutationObserver = new MutationObserver(handleMutation);
  state.mutationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

function observeRouteChanges() {
  clearInterval(state.routeTimer);
  state.routeTimer = setInterval(async () => {
    const nextConversationId = getConversationId();
    if (nextConversationId === state.conversationId) {
      return;
    }

    state.conversationId = nextConversationId;
    state.pendingAsk = null;
    state.lastSelection = null;
    await loadConversationData();
    await loadNavigationState();
    scheduleRender();
  }, 1000);
}

function handleStorageChange(changes, areaName) {
  if (areaName !== "local" || !changes[SETTINGS_KEY]) {
    return;
  }

  state.settings = mergeSettings(changes[SETTINGS_KEY].newValue);
  scheduleRender();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "YACHT_PING") {
    sendResponse({
      ok: true,
      pageTitle: document.title,
      location: window.location.href,
      conversationId: state.conversationId,
      enabled: state.settings.enabled,
      mode: state.mode,
      anchors: state.data.anchors.length,
      threads: state.data.threads.length,
      failSafe: state.failSafe,
      diagnostic: state.diagnostic
    });
    return false;
  }

  if (message?.type === "YACHT_REFRESH_FROM_STORAGE") {
    loadSettings()
      .then(loadConversationData)
      .then(loadNavigationState)
      .then(() => {
        scheduleRender();
        sendResponse({ ok: true });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function initialize() {
  if (state.initialized) {
    return;
  }

  state.initialized = true;

  try {
    await loadSettings();
    await loadConversationData();
    await loadNavigationState();
  } catch (error) {
    console.error("[Yacht] initialization failed", error);
    setDiagnostic("Ask Subthreads could not initialize local extension storage.");
  }

  document.addEventListener("selectionchange", () => {
    window.setTimeout(captureSelection, 60);
  });
  document.addEventListener("pointerdown", handleDocumentPointerDown, true);
  document.addEventListener("click", handleDocumentClick, true);
  chrome.storage.onChanged.addListener(handleStorageChange);

  observeDom();
  observeRouteChanges();
  refreshRepliedContentState();
  render();
}

initialize();
