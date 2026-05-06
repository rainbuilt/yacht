# YACHT Architecture

## 1. Overview

YACHT is a Chrome extension for `https://chatgpt.com/*`.

The extension is declared in `manifest.json`. That file tells Chrome what to load, where it should run, which permissions it needs, and which extension files are allowed to be imported by the content script.

There is no build step described by this repository. Chrome loads the files directly from the paths listed in `manifest.json`.

Simple map:

```text
manifest.json
  -> extension icons
       src/icons/icon-16.png
       src/icons/icon-32.png
       src/icons/icon-48.png
       src/icons/icon-128.png
  -> background service worker
       src/background/service-worker.js
  -> content script loader
       src/content/content.js
          -> src/content/app.js
             -> content modules under src/content/
  -> popup
       src/popup/popup.html
       src/popup/popup.js
       src/popup/popup.css
```

## 2. Runtime Components

The main runtime components are:

- `manifest.json`: the Chrome extension configuration.
- `src/icons/icon-*.png`: generated extension and toolbar icons derived from `logo.png`.
- `src/background/service-worker.js`: the Manifest V3 background service worker.
- `src/content/content.js`: the content script file listed in the manifest.
- `src/content/app.js`: the main content application module.
- Content modules under `src/content/`: smaller modules used by `app.js`.
- `src/popup/popup.html`: the popup UI opened from the extension button.
- `src/popup/popup.js`: the popup behavior.
- `src/popup/popup.css`: the popup styling.

The content side runs inside matching ChatGPT pages. The background service worker owns long-lived extension data APIs. The popup gives the user controls for settings, import, export, reset, and connection status.

## 3. Manifest V3 Loading Model

`manifest.json` uses Manifest V3:

```json
"manifest_version": 3
```

The extension runs on ChatGPT because both `content_scripts.matches` and `host_permissions` include:

```json
"https://chatgpt.com/*"
```

The background worker is declared here:

```json
"background": {
  "service_worker": "src/background/service-worker.js",
  "type": "module"
}
```

The `"type": "module"` setting means `src/background/service-worker.js` runs as an ES module.

The content script entry is declared here:

```json
"content_scripts": [
  {
    "matches": ["https://chatgpt.com/*"],
    "js": ["src/content/content.js"],
    "css": ["src/content/content.css"],
    "run_at": "document_idle"
  }
]
```

This content script remains a classic content script. It is not declared as a module in the manifest.

The popup is declared here:

```json
"action": {
  "default_title": "YACHT",
  "default_popup": "src/popup/popup.html",
  "default_icon": {
    "16": "src/icons/icon-16.png",
    "32": "src/icons/icon-32.png",
    "48": "src/icons/icon-48.png",
    "128": "src/icons/icon-128.png"
  }
}
```

The extension-level icon set is declared with the same generated files:

```json
"icons": {
  "16": "src/icons/icon-16.png",
  "32": "src/icons/icon-32.png",
  "48": "src/icons/icon-48.png",
  "128": "src/icons/icon-128.png"
}
```

The extension requests `activeTab` and `storage` permissions. `storage` is needed for `chrome.storage.local`. `activeTab` is used by the popup when it checks and refreshes the current tab.

## 4. Content Script Entry Flow

Chrome starts the content side by loading `src/content/content.js` on `https://chatgpt.com/*`.

That file is intentionally small:

```js
const moduleUrl = chrome.runtime.getURL("src/content/app.js");
const { initialize } = await import(moduleUrl);
await initialize();
```

The loader gets a full extension URL for `src/content/app.js`, dynamically imports it, then calls `initialize()`.

`src/content/app.js` is the main content application. During initialization it:

- loads settings from the background service worker,
- loads conversation data for the current ChatGPT conversation,
- loads local navigation state from `chrome.storage.local`,
- registers document event handlers,
- listens for `chrome.storage.local` changes,
- starts DOM observation,
- watches for ChatGPT route changes,
- renders YACHT controls and source links.

The content modules under `src/content/` keep the implementation split by job:

- `constants.js` stores selectors, keys, timing values, and schema constants.
- `dom-readers.js` reads ChatGPT page structure.
- `diagnostics.js` records simple DOM health checks.
- `events.js` registers document-level event listeners.
- `observers.js` owns the `MutationObserver` setup.
- `persistence.js` wraps runtime messages and some local navigation storage.
- `selection.js` reads selected source text.
- `state.js` holds content-side runtime state.
- `thread-model.js` manages anchors, threads, and message-key relationships.
- `utils.js` contains shared content helpers.

## 5. Background Service Worker

`src/background/service-worker.js` is the extension's background service worker.

It listens for messages with:

```js
chrome.runtime.onMessage.addListener(...)
```

It handles message types such as:

- `YACHT_GET_SETTINGS`
- `YACHT_SAVE_SETTINGS`
- `YACHT_GET_CONVERSATION_DATA`
- `YACHT_UPSERT_ANCHOR`
- `YACHT_UPSERT_THREAD`
- `YACHT_EXPORT_DATA`
- `YACHT_IMPORT_DATA`
- `YACHT_RESET_ALL_DATA`
- `YACHT_GET_TAB_INFO`

Settings are stored with `chrome.storage.local`.

Anchor and thread records are stored in IndexedDB. The background service worker opens the `yacht-subthreads` database and manages the `anchors` and `threads` object stores.

This means the content script and popup do not write anchor and thread data directly. They ask the background service worker to do it by sending runtime messages.

## 6. Popup

The popup starts at `src/popup/popup.html`.

That file links `src/popup/popup.css` for styles and loads `src/popup/popup.js` as a module:

```html
<script src="./popup.js" type="module"></script>
```

The popup UI contains:

- a connection status for the current ChatGPT tab,
- an enabled toggle,
- source-link color and underline controls,
- export JSON,
- import JSON,
- merge or replace import mode,
- reset all data.

`src/popup/popup.js` talks to the background service worker with `chrome.runtime.sendMessage`. It also talks to the active ChatGPT tab with `chrome.tabs.sendMessage` for `YACHT_PING` and `YACHT_REFRESH_FROM_STORAGE`.

`src/popup/popup.css` only styles the popup. It does not affect the ChatGPT page.

## 7. Storage and Data Ownership

There are two storage systems in use.

`chrome.storage.local` stores settings and content-side navigation state.

The main settings key is:

```text
yacht.settings
```

The content script also saves per-conversation navigation state through `src/content/persistence.js`. This remembers whether the user was in the main conversation or a subthread.

IndexedDB stores source anchors and subthreads. The IndexedDB database is:

```text
yacht-subthreads
```

It has these object stores:

- `anchors`
- `threads`

The background service worker owns this IndexedDB database. Content and popup code request data through the background service worker instead of opening this database themselves.

## 8. Runtime Message Flow

Runtime messages are the main communication path between extension parts.

The content app sends messages through `src/content/persistence.js`:

```js
chrome.runtime.sendMessage({ type, ...payload })
```

For example, the content app asks for settings, loads conversation data, and upserts anchors or threads.

The popup also uses `chrome.runtime.sendMessage` to ask the background service worker to load settings, save settings, export data, import data, and reset data.

The background service worker receives those messages, performs the storage work, and returns a response object.

The popup also sends tab messages:

- `YACHT_PING` checks whether the content script is alive in the active ChatGPT tab.
- `YACHT_REFRESH_FROM_STORAGE` tells the content script to reload settings and data after a popup action.

`src/content/app.js` listens for those tab messages and responds from the ChatGPT page.

## 9. Why Dynamic Import Is Used

`src/content/content.js` is the file listed directly in `manifest.json`.

That manifest-listed content script remains a classic content script. Classic content scripts cannot use normal top-level `import` statements the same way a module script can.

To keep the real content code organized as ES modules, `content.js` uses dynamic import:

```js
const moduleUrl = chrome.runtime.getURL("src/content/app.js");
const { initialize } = await import(moduleUrl);
```

This allows `src/content/app.js` to import the other content modules under `src/content/`.

The dynamically imported files must be listed in `web_accessible_resources` in `manifest.json`. That is why `src/content/app.js` and its imported content modules are listed there.

The `web_accessible_resources` entry is limited to:

```json
"matches": ["https://chatgpt.com/*"]
```

This allows the ChatGPT content-script environment to load those extension module files while keeping the exposure scoped to ChatGPT pages.

## 10. Maintenance Rules

Keep `manifest.json` and the actual file structure in sync. If `src/content/app.js` imports a new content module, add that module to `web_accessible_resources`.

If the extension logo changes, regenerate the packaged icon files in `src/icons/` from `logo.png` and verify both `manifest.icons` and `action.default_icon` still point to the generated 16, 32, 48, and 128 pixel PNG files.

Keep `src/content/content.js` small. It should stay focused on loading `src/content/app.js` and reporting load failures.

Keep page behavior in `src/content/app.js` and the modules under `src/content/`. These files run against the ChatGPT page DOM, so changes should be tested on `https://chatgpt.com/*`.

Keep storage ownership clear. Settings and navigation state use `chrome.storage.local`. Anchor and thread records belong to the IndexedDB database managed by `src/background/service-worker.js`.

Use `chrome.runtime.sendMessage` when content or popup code needs the background service worker to read, write, import, export, or reset extension data.

Use `chrome.tabs.sendMessage` only when the popup needs to talk to the content script running in the active ChatGPT tab.

Do not assume the background service worker is always awake. Manifest V3 service workers can start when needed and stop when idle. Message handlers should do the work needed for each request.

Do not add a build-step assumption to this architecture unless the repository actually introduces one.
