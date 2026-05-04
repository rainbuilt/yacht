const DEFAULT_SETTINGS = {
  helperEnabled: true
};

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== chrome.runtime.OnInstalledReason.INSTALL) {
    return;
  }

  await chrome.storage.sync.set(DEFAULT_SETTINGS);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "YACHT_GET_TAB_INFO") {
    return false;
  }

  sendResponse({
    tabId: sender.tab?.id ?? null,
    url: sender.tab?.url ?? null
  });

  return false;
});
