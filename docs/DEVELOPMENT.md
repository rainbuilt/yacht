# Development Guide

This guide is for maintainers working on YACHT, a Chrome Manifest V3 extension for ChatGPT.

## Prerequisites

- Google Chrome or another Chromium browser that supports Manifest V3 extensions.
- Node.js, only for running the repository validation script.
- Basic familiarity with Chrome extension development, content scripts, `chrome.storage`, runtime messages, and IndexedDB.

No build step currently exists. The extension is loaded directly from the repository folder.

No npm dependencies should be introduced unless explicitly approved. Keep the extension dependency-free unless there is a clear maintainer decision to change that policy.

## Repository Layout

```text
manifest.json                    Chrome Manifest V3 extension manifest
package.json                     npm scripts; currently validation only
scripts/validate-extension.mjs    Local manifest and file sanity checks

src/background/service-worker.js  MV3 background service worker

src/content/content.js            Content script entry injected by Chrome
src/content/app.js                Main content implementation, dynamically imported
src/content/constants.js          Shared content constants and ChatGPT selectors
src/content/dom-readers.js        DOM reads, message keys, and turn extraction
src/content/diagnostics.js        Fail-safe diagnostics
src/content/events.js             Document event registration
src/content/observers.js          Mutation observer setup
src/content/persistence.js        Runtime and navigation persistence helpers
src/content/selection.js          Assistant text selection capture
src/content/state.js              Runtime state for the content script
src/content/thread-model.js       Thread and visibility model
src/content/utils.js              Shared content utilities
src/content/content.css           Injected ChatGPT page styles

src/popup/popup.html              Extension popup markup
src/popup/popup.js                Popup behavior
src/popup/popup.css               Popup styles
```

The content script entry is `src/content/content.js`. It dynamically imports the main implementation from `src/content/app.js` using `chrome.runtime.getURL()`.

Any content module that is dynamically imported must be listed in `web_accessible_resources` in `manifest.json`, or Chrome will block the import.

## Loading the Extension in Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select the repository root.
5. Open or refresh `https://chatgpt.com`.

After changing extension files, reload the extension from `chrome://extensions`. Then refresh any open ChatGPT tabs so the content script is reinjected.

## Development Loop

1. Edit the relevant source files.
2. Run `npm run validate`.
3. Reload the extension from `chrome://extensions`.
4. Refresh open ChatGPT tabs after reloading.
5. Reproduce the affected workflow in ChatGPT.
6. Check the ChatGPT tab console and the extension service worker console for errors.

Because there is no bundler or build step, browser-loaded paths must remain valid as written. Keep imports explicit and relative.

## Validation

Run:

```bash
npm run validate
```

This is the required local validation command. It checks the extension structure and manifest assumptions, including referenced files.

Also validate manually in Chrome when behavior touches:

- Content script injection or dynamic imports.
- ChatGPT DOM selectors.
- Source link rendering or thread visibility.
- Runtime messages between popup, content, and background.
- Storage, import, export, reset, or migration behavior.

## Working on Content Scripts

Chrome injects `src/content/content.js` on `https://chatgpt.com/*`. That file is intentionally small: it imports `src/content/app.js` and calls `initialize()`.

Most content script changes belong in the modules under `src/content/`, not in `content.js`.

When adding a dynamically imported content module:

1. Add the module file under `src/content/`.
2. Import it from an existing content module.
3. Add it to `manifest.json` under `web_accessible_resources`.
4. Run `npm run validate`.
5. Reload the extension and refresh ChatGPT tabs.

Use the existing state, persistence, thread model, and DOM reader modules before adding new global state or new cross-module contracts.

## Working on ChatGPT DOM Selectors

ChatGPT DOM changes are expected. Keep selector changes isolated to `constants.js` and DOM reader code when possible.

Primary selector locations:

- `src/content/constants.js`: `SELECTORS`, text ignore selectors, source-link safety selectors.
- `src/content/dom-readers.js`: turn reading, message key generation, user reference detection.
- `src/content/diagnostics.js`: fail-safe detection when the ChatGPT message DOM is not recognized.
- `src/content/observers.js`: observation roots for page changes.

When changing selectors:

1. Prefer the narrowest change that restores the broken read.
2. Preserve stable message keys where possible.
3. Test on existing conversations and newly created conversations.
4. Confirm the fail-safe diagnostic still appears when expected.

## Working on Background Storage

`src/background/service-worker.js` owns persisted extension data.

Current storage areas:

- `chrome.storage.local` for settings and navigation state.
- IndexedDB database `yacht-subthreads` for anchors and threads.

Storage keys and runtime message names should not be renamed casually. Existing keys and message names are part of the extension's internal compatibility contract.

Important contracts include:

- Settings key: `yacht.settings`.
- Navigation key prefix: `yacht.nav.`.
- Runtime messages such as `YACHT_GET_SETTINGS`, `YACHT_SAVE_SETTINGS`, `YACHT_GET_CONVERSATION_DATA`, `YACHT_UPSERT_ANCHOR`, `YACHT_UPSERT_THREAD`, `YACHT_EXPORT_DATA`, `YACHT_IMPORT_DATA`, `YACHT_RESET_ALL_DATA`, and `YACHT_GET_TAB_INFO`.
- IndexedDB database name: `yacht-subthreads`.
- IndexedDB stores: `anchors` and `threads`.

IndexedDB schema changes require migration planning. If `DB_VERSION`, object stores, indexes, record shape, or schema version changes, document the migration path and test upgrade from an existing profile with stored data.

## Working on Popup UI

Popup files live in `src/popup/`.

- `popup.html` defines controls and import/export/reset UI.
- `popup.js` reads and saves settings through background runtime messages.
- `popup.css` styles the popup.

When adding a popup setting:

1. Add the control to `popup.html`.
2. Add element bindings, normalization, rendering, and save behavior in `popup.js`.
3. Add default settings in both content/background settings definitions as needed.
4. Ensure the content script reloads or refreshes from storage when the setting changes.
5. Run `npm run validate`, reload the extension, and test the popup on a ChatGPT tab.

The popup has fallback behavior when the background API is unavailable. Keep that path in mind when changing settings import/export behavior.

## Working on Styles

Injected ChatGPT page styles live in `src/content/content.css`. Popup styles live in `src/popup/popup.css`.

For source link styling, check both:

- `src/content/content.css` for `.yacht-source-link`.
- `DEFAULT_SETTINGS.sourceLinkStyle` and popup controls for user-configurable color and underline behavior.

Keep injected CSS scoped with `yacht-` class names. Avoid broad selectors that could affect ChatGPT's own UI.

## Things Not to Change Casually

- Runtime message names.
- Storage keys.
- IndexedDB database name, version, store names, indexes, or record shapes.
- Message key generation in `src/content/dom-readers.js`.
- Import/export payload schema.
- `web_accessible_resources` coverage for dynamically imported content modules.
- Content script entry path `src/content/content.js`.
- The no-build, no-dependency baseline.
- Thread visibility rules in `src/content/thread-model.js` and render code without manual regression testing.

## Recommended Change Process

1. Identify the ownership area: selector, content behavior, storage, popup, or style.
2. Make the smallest compatible change.
3. Preserve existing storage and runtime contracts unless a migration is planned.
4. Run `npm run validate`.
5. Reload the extension from `chrome://extensions`.
6. Refresh open ChatGPT tabs after reloading.
7. Test one existing conversation and one fresh conversation when content behavior changes.
8. Check console output in the ChatGPT tab and service worker.
9. Update docs when behavior, storage, or maintainer workflow changes.

## Common Tasks

| Task | Primary files | Notes |
| --- | --- | --- |
| Change selector | `src/content/constants.js`, `src/content/dom-readers.js` | Keep ChatGPT DOM selector changes isolated to constants and DOM reader code when possible. |
| Change source link style | `src/content/content.css`, `src/content/constants.js`, `src/popup/` | Preserve `sourceLinkStyle` settings compatibility. |
| Add popup setting | `src/popup/popup.html`, `src/popup/popup.js`, `src/popup/popup.css`, settings defaults | Update normalization, save, preview or refresh behavior, and defaults. |
| Change thread visibility logic | `src/content/thread-model.js`, `src/content/app.js` | Test main thread, subthread, nested thread, and return-to-main behavior. |
| Change stored data | `src/background/service-worker.js`, `src/content/persistence.js`, import/export paths | Plan migrations for IndexedDB schema changes and avoid casual key renames. |
| Debug fail-safe | `src/content/diagnostics.js`, `src/content/constants.js`, `src/content/dom-readers.js` | Confirm whether `SELECTORS.message` and `SELECTORS.turn` still match ChatGPT. |
| Debug content script loading | `src/content/content.js`, `src/content/app.js`, `manifest.json` | Check dynamic imports, `web_accessible_resources`, console errors, reload extension, then refresh ChatGPT tabs. |

## Commit/Review Checklist

- `npm run validate` passes.
- The extension has been reloaded from `chrome://extensions`.
- Open ChatGPT tabs have been refreshed after reloading.
- Affected ChatGPT workflows were manually checked.
- No npm dependencies were added without explicit approval.
- Dynamically imported content modules are listed in `web_accessible_resources`.
- Storage keys and runtime message names were not renamed casually.
- IndexedDB schema changes include migration planning.
- Selector changes are isolated to `constants.js` and DOM reader code where practical.
- Popup changes were tested with the active tab connected to ChatGPT.
