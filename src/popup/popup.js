const CHATGPT_URL_PATTERNS = [
  "https://chatgpt.com/",
  "https://chat.openai.com/"
];

const elements = {
  helperToggle: document.querySelector("#helper-toggle"),
  pageTitle: document.querySelector("#page-title"),
  pageUrl: document.querySelector("#page-url"),
  status: document.querySelector("#status")
};

function isChatGptUrl(url = "") {
  return CHATGPT_URL_PATTERNS.some((pattern) => url.startsWith(pattern));
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tab;
}

async function pingContentScript(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "YACHT_PING" });
  } catch {
    return null;
  }
}

async function loadSettings() {
  const settings = await chrome.storage.sync.get({ helperEnabled: true });
  elements.helperToggle.checked = Boolean(settings.helperEnabled);
}

async function renderActiveTabState() {
  const tab = await getActiveTab();
  const url = tab?.url ?? "";

  elements.pageUrl.textContent = url || "-";

  if (!tab?.id || !isChatGptUrl(url)) {
    elements.status.textContent = "Open ChatGPT to use this extension.";
    elements.pageTitle.textContent = tab?.title ?? "-";
    return;
  }

  const response = await pingContentScript(tab.id);
  elements.status.textContent = response?.ok
    ? "Connected to ChatGPT."
    : "Refresh the ChatGPT tab to connect.";
  elements.pageTitle.textContent = response?.pageTitle ?? tab.title ?? "-";
}

elements.helperToggle.addEventListener("change", async (event) => {
  await chrome.storage.sync.set({
    helperEnabled: event.currentTarget.checked
  });
});

await loadSettings();
await renderActiveTabState();
