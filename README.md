# Yacht for ChatGPT

Chrome extension development baseline for the ChatGPT website.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this repository folder.
5. Open `https://chatgpt.com` and click the extension action in the toolbar.

## Project Structure

```text
manifest.json                    Extension manifest
src/background/service-worker.js  Extension lifecycle and defaults
src/content/content.js            Script injected into ChatGPT pages
src/content/content.css           Styles for injected UI
src/popup/popup.html              Extension popup
src/popup/popup.css               Popup styles
src/popup/popup.js                Popup behavior
scripts/validate-extension.mjs    Local manifest sanity check
```

## Development

Run the dependency-free validation check:

```bash
npm run validate
```

After editing source files, reload the extension from `chrome://extensions` and refresh any open ChatGPT tabs.
