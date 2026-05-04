const CHATGPT_URL_PATTERNS = [
  "https://chatgpt.com/"
];

const FALLBACK_SETTINGS_KEY = "yachtSettings";
const SAVE_DEBOUNCE_MS = 200;

const DEFAULT_SETTINGS = {
  schemaVersion: 1,
  enabled: true,
  sourceLinkStyle: {
    color: "#111111",
    underline: true
  }
};

const elements = {
  actionStatus: document.querySelector("#action-status"),
  confirmCancel: document.querySelector("#confirm-cancel"),
  confirmDialog: document.querySelector("#confirm-dialog"),
  confirmReset: document.querySelector("#confirm-reset"),
  enabledToggle: document.querySelector("#enabled-toggle"),
  exportButton: document.querySelector("#export-button"),
  importButton: document.querySelector("#import-button"),
  importFile: document.querySelector("#import-file"),
  importFileName: document.querySelector("#import-file-name"),
  linkColor: document.querySelector("#link-color"),
  linkUnderline: document.querySelector("#link-underline"),
  resetButton: document.querySelector("#reset-button"),
  sourcePreview: document.querySelector("#source-preview"),
  status: document.querySelector("#status"),
  statusDot: document.querySelector("#status-dot")
};

let currentSettings = structuredClone(DEFAULT_SETTINGS);
let saveTimer = null;
let confirmResolver = null;

function isChatGptUrl(url = "") {
  return CHATGPT_URL_PATTERNS.some((pattern) => url.startsWith(pattern));
}

function isHexColor(value) {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function normalizeSettings(settings = {}) {
  const incomingStyle = settings.sourceLinkStyle ?? {};
  const defaultStyle = DEFAULT_SETTINGS.sourceLinkStyle;

  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    enabled: Boolean(settings.enabled ?? DEFAULT_SETTINGS.enabled),
    sourceLinkStyle: {
      ...defaultStyle,
      ...incomingStyle,
      color: isHexColor(incomingStyle.color) ? incomingStyle.color : defaultStyle.color,
      underline: Boolean(incomingStyle.underline ?? defaultStyle.underline)
    }
  };
}

function readSettingsFromControls() {
  return normalizeSettings({
    ...currentSettings,
    enabled: elements.enabledToggle.checked,
    sourceLinkStyle: {
      ...(currentSettings.sourceLinkStyle ?? {}),
      color: elements.linkColor.value,
      underline: elements.linkUnderline.checked
    }
  });
}

function renderSettings(settings) {
  currentSettings = normalizeSettings(settings);
  elements.enabledToggle.checked = currentSettings.enabled;
  elements.linkColor.value = currentSettings.sourceLinkStyle.color;
  elements.linkUnderline.checked = currentSettings.sourceLinkStyle.underline;
  renderPreview();
}

function renderPreview() {
  const style = readSettingsFromControls().sourceLinkStyle;
  elements.sourcePreview.style.setProperty("--source-preview-color", style.color);
  elements.sourcePreview.dataset.underline = String(style.underline);
}

function setConnectionStatus(message, state = "neutral") {
  elements.status.textContent = message;
  elements.statusDot.dataset.state = state;
}

function setActionStatus(message = "", tone = "") {
  elements.actionStatus.textContent = message;

  if (tone) {
    elements.actionStatus.dataset.tone = tone;
  } else {
    delete elements.actionStatus.dataset.tone;
  }
}

function setBusy(isBusy) {
  elements.exportButton.disabled = isBusy;
  elements.importButton.disabled = isBusy || !elements.importFile.files?.length;
  elements.resetButton.disabled = isBusy;
  elements.enabledToggle.disabled = isBusy;
  elements.linkColor.disabled = isBusy;
  elements.linkUnderline.disabled = isBusy;
}

function resolveConfirmDialog(confirmed) {
  if (!confirmResolver) {
    return;
  }

  const resolve = confirmResolver;
  confirmResolver = null;
  elements.confirmDialog.hidden = true;
  resolve(confirmed);
}

function requestResetConfirmation() {
  elements.confirmDialog.hidden = false;
  elements.confirmReset.focus();

  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}

function getSelectedImportMode() {
  return document.querySelector('input[name="import-mode"]:checked')?.value ?? "merge";
}

function hasResponse(response) {
  return response !== null && response !== undefined;
}

function sendRuntimeMessage(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      const error = chrome.runtime.lastError;

      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(response);
    });
  });
}

async function requestBackground(type, payload) {
  try {
    return await sendRuntimeMessage(type, payload);
  } catch {
    return null;
  }
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

async function refreshActiveContentScript() {
  const tab = await getActiveTab();
  const url = tab?.url ?? "";

  if (!tab?.id || !isChatGptUrl(url)) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "YACHT_REFRESH_FROM_STORAGE" });
  } catch {
    // The tab may not have a connected content script yet.
  }
}

async function loadSettings() {
  const response = await requestBackground("YACHT_GET_SETTINGS");

  if (hasResponse(response) && Object.hasOwn(response, "settings")) {
    renderSettings(response.settings);
    return;
  }

  const fallback = await chrome.storage.local.get({
    [FALLBACK_SETTINGS_KEY]: DEFAULT_SETTINGS
  });

  renderSettings(fallback[FALLBACK_SETTINGS_KEY]);
  setActionStatus("Background settings API is not responding; using local fallback.", "warning");
}

async function saveSettings(settings) {
  currentSettings = normalizeSettings(settings);
  const response = await requestBackground("YACHT_SAVE_SETTINGS", {
    settings: currentSettings
  });

  if (response?.ok === false) {
    throw new Error("Background rejected the settings update.");
  }

  if (hasResponse(response)) {
    setActionStatus("Settings saved.", "success");
    return;
  }

  await chrome.storage.local.set({
    [FALLBACK_SETTINGS_KEY]: currentSettings
  });
  setActionStatus("Settings saved locally; background API is not responding.", "warning");
}

function queueSaveSettings() {
  window.clearTimeout(saveTimer);
  renderPreview();

  saveTimer = window.setTimeout(async () => {
    try {
      await saveSettings(readSettingsFromControls());
      await refreshActiveContentScript();
    } catch (error) {
      setActionStatus(`Could not save settings: ${error.message}`, "error");
    }
  }, SAVE_DEBOUNCE_MS);
}

async function renderActiveTabState() {
  const tab = await getActiveTab();
  const url = tab?.url ?? "";

  if (!tab?.id || !isChatGptUrl(url)) {
    setConnectionStatus("Open ChatGPT to use the navigator.", "warning");
    return;
  }

  const response = await pingContentScript(tab.id);

  if (response?.ok) {
    setConnectionStatus("Connected to ChatGPT.", "connected");
    return;
  }

  setConnectionStatus("Refresh the ChatGPT tab to connect.", "warning");
}

function downloadJson(payload) {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);

  anchor.href = url;
  anchor.download = `yacht-export-${date}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function getLocalStoragePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Import payload must be a JSON object.");
  }

  if (payload.storage && typeof payload.storage === "object" && !Array.isArray(payload.storage)) {
    return payload.storage;
  }

  if (payload.settings && typeof payload.settings === "object" && !Array.isArray(payload.settings)) {
    return {
      [FALLBACK_SETTINGS_KEY]: payload.settings
    };
  }

  return payload;
}

async function importDataToLocalStorage(mode, payload) {
  const storagePayload = getLocalStoragePayload(payload);

  if (mode === "replace") {
    await chrome.storage.local.clear();
  }

  await chrome.storage.local.set(storagePayload);
}

async function exportData() {
  setBusy(true);
  setActionStatus("Preparing export...");

  try {
    const response = await requestBackground("YACHT_EXPORT_DATA");
    let payload = response?.payload;

    if (response?.ok === false) {
      throw new Error("Background rejected the export.");
    }

    if (!payload) {
      const localData = await chrome.storage.local.get(null);
      payload = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        storage: localData
      };
    }

    downloadJson(payload);
    setActionStatus("Export downloaded.", "success");
  } catch (error) {
    setActionStatus(`Export failed: ${error.message}`, "error");
  } finally {
    setBusy(false);
  }
}

async function importData() {
  const [file] = elements.importFile.files ?? [];

  if (!file) {
    setActionStatus("Choose a JSON file to import.", "warning");
    return;
  }

  setBusy(true);
  setActionStatus("Importing data...");

  try {
    const payload = JSON.parse(await file.text());
    const mode = getSelectedImportMode();
    const response = await requestBackground("YACHT_IMPORT_DATA", {
      mode,
      payload
    });

    if (response?.ok === false) {
      throw new Error("Background rejected the import.");
    }

    if (!hasResponse(response)) {
      await importDataToLocalStorage(mode, payload);
    }

    await loadSettings();
    await refreshActiveContentScript();
    setActionStatus(`Import complete using ${mode} mode.`, "success");
  } catch (error) {
    setActionStatus(`Import failed: ${error.message}`, "error");
  } finally {
    setBusy(false);
  }
}

async function resetAllData() {
  const confirmed = await requestResetConfirmation();

  if (!confirmed) {
    return;
  }

  setBusy(true);
  setActionStatus("Resetting data...");
  window.clearTimeout(saveTimer);

  try {
    const response = await requestBackground("YACHT_RESET_ALL_DATA");

    if (response?.ok === false) {
      throw new Error("Background rejected the reset.");
    }

    if (!hasResponse(response)) {
      await chrome.storage.local.clear();
    }

    renderSettings(DEFAULT_SETTINGS);
    await refreshActiveContentScript();
    setActionStatus("All data reset.", "success");
  } catch (error) {
    setActionStatus(`Reset failed: ${error.message}`, "error");
  } finally {
    setBusy(false);
  }
}

function bindEvents() {
  elements.enabledToggle.addEventListener("change", queueSaveSettings);
  elements.linkColor.addEventListener("input", queueSaveSettings);
  elements.linkUnderline.addEventListener("change", queueSaveSettings);
  elements.exportButton.addEventListener("click", exportData);
  elements.importButton.addEventListener("click", importData);
  elements.resetButton.addEventListener("click", resetAllData);
  elements.confirmCancel.addEventListener("click", () => resolveConfirmDialog(false));
  elements.confirmReset.addEventListener("click", () => resolveConfirmDialog(true));
  elements.confirmDialog.addEventListener("click", (event) => {
    if (event.target === elements.confirmDialog) {
      resolveConfirmDialog(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.confirmDialog.hidden) {
      resolveConfirmDialog(false);
    }
  });

  elements.importFile.addEventListener("change", () => {
    const [file] = elements.importFile.files ?? [];

    elements.importFileName.textContent = file?.name ?? "No file selected";
    elements.importButton.disabled = !file;
  });
}

async function initialize() {
  bindEvents();
  setBusy(true);

  await Promise.all([loadSettings(), renderActiveTabState()]);
  setBusy(false);
}

initialize().catch((error) => {
  setBusy(false);
  setConnectionStatus("Popup failed to initialize.", "error");
  setActionStatus(error.message, "error");
});
