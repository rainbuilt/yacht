(async () => {
  try {
    const moduleUrl = chrome.runtime.getURL("src/content/app.js");
    const { initialize } = await import(moduleUrl);
    await initialize();
  } catch (error) {
    console.error("[Yacht] content script failed to load", error);
  }
})();
