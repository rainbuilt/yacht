const ROOT_ID = "yacht-extension-root";
const SETTINGS_KEY = "helperEnabled";

function createBadge() {
  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.className = "yacht-extension-root";

  const badge = document.createElement("div");
  badge.className = "yacht-extension-badge";
  badge.setAttribute("role", "status");

  const dot = document.createElement("span");
  dot.className = "yacht-extension-dot";
  dot.setAttribute("aria-hidden", "true");

  const label = document.createElement("span");
  label.textContent = "Yacht active";

  badge.append(dot, label);
  root.append(badge);

  return root;
}

function removeBadge() {
  document.getElementById(ROOT_ID)?.remove();
}

function renderBadge(enabled) {
  if (!enabled) {
    removeBadge();
    return;
  }

  if (!document.getElementById(ROOT_ID)) {
    document.documentElement.append(createBadge());
  }
}

async function readSettings() {
  const settings = await chrome.storage.sync.get({ [SETTINGS_KEY]: true });
  return {
    helperEnabled: Boolean(settings[SETTINGS_KEY])
  };
}

async function initialize() {
  const settings = await readSettings();
  renderBadge(settings.helperEnabled);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !changes[SETTINGS_KEY]) {
    return;
  }

  renderBadge(Boolean(changes[SETTINGS_KEY].newValue));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "YACHT_PING") {
    return false;
  }

  sendResponse({
    ok: true,
    pageTitle: document.title,
    location: window.location.href
  });

  return false;
});

initialize();
