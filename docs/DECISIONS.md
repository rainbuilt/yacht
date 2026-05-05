# Architectural Decisions

This document records current architectural decisions for YACHT so future maintainers can understand the tradeoffs behind the extension structure.

## 1. Chrome Manifest V3

- **Status:** Accepted
- **Context:** The extension is declared with `manifest_version: 3`, uses a background service worker, and targets ChatGPT through declared content scripts and host permissions.
- **Decision:** YACHT is built as a Chrome Manifest V3 extension.
- **Consequences:** The project follows MV3 constraints, including service-worker background execution and explicit resource declarations. Background code cannot assume a long-lived page context.
- **Files involved:** `manifest.json`, `src/background/service-worker.js`, `src/content/content.js`

## 2. No Build Step

- **Status:** Accepted
- **Context:** The manifest points directly at source files, and `package.json` only defines a validation script.
- **Decision:** Source files are loaded directly by Chrome without bundling or transpilation.
- **Consequences:** The extension is simple to inspect and load during development. The tradeoff is that all browser-loaded module paths must remain valid as written, and language features must be supported by the target Chrome runtime.
- **Files involved:** `manifest.json`, `package.json`, `src/content/content.js`, `src/content/app.js`

## 3. No New npm Dependencies by Default

- **Status:** Accepted
- **Context:** `package.json` contains no dependencies, and the extension code uses browser and Chrome extension APIs directly.
- **Decision:** New npm dependencies should not be added by default.
- **Consequences:** The codebase stays small and avoids dependency supply-chain and build-process costs. The tradeoff is that shared utilities and browser API wrappers are maintained locally when needed.
- **Files involved:** `package.json`, `src/content/utils.js`, `src/background/service-worker.js`

## 4. Content Script Loader Uses Dynamic Import

- **Status:** Accepted
- **Context:** `src/content/content.js` is the registered content script. It resolves `src/content/app.js` with `chrome.runtime.getURL()` and loads it with `import()`.
- **Decision:** Keep the registered content script as a small loader and put the application logic in dynamically imported ES modules.
- **Consequences:** Content logic can be split into modules while the manifest keeps a single content script entry point. The tradeoff is that imported modules must be exposed as web-accessible resources.
- **Files involved:** `manifest.json`, `src/content/content.js`, `src/content/app.js`

## 5. Dynamic Content Modules Are Web-Accessible Resources

- **Status:** Accepted
- **Context:** The manifest lists content modules such as `app.js`, `constants.js`, `state.js`, and `thread-model.js` under `web_accessible_resources`.
- **Decision:** Dynamically imported content modules are explicitly listed in `web_accessible_resources`.
- **Consequences:** Chrome can load the modules requested by the content script. The tradeoff is maintenance overhead: adding, removing, or renaming imported content modules requires updating the manifest.
- **Files involved:** `manifest.json`, `src/content/content.js`, `src/content/app.js`

## 6. Background Service Worker Owns IndexedDB Access

- **Status:** Accepted
- **Context:** IndexedDB is opened and mutated in `src/background/service-worker.js`. Content code requests conversation data and persistence through runtime messages.
- **Decision:** Persistent anchor and thread data stored in IndexedDB is owned by the background service worker.
- **Consequences:** Storage behavior is centralized outside the ChatGPT page context. The tradeoff is that content code must use asynchronous messaging for database reads and writes.
- **Files involved:** `src/background/service-worker.js`, `src/content/persistence.js`, `src/content/app.js`

## 7. Content Script Uses Runtime Messages for Background Work

- **Status:** Accepted
- **Context:** `src/content/persistence.js` wraps `chrome.runtime.sendMessage()`, and the background worker handles `YACHT_*` message types.
- **Decision:** Content scripts communicate with the background service worker through Chrome runtime messages.
- **Consequences:** The content layer does not directly own background-only work such as IndexedDB persistence, import, export, and settings writes. The tradeoff is that message names and payload shapes become an internal API that must stay coordinated.
- **Files involved:** `src/content/persistence.js`, `src/background/service-worker.js`, `src/content/app.js`

## 8. ChatGPT DOM Is Read Directly

- **Status:** Accepted
- **Context:** YACHT reads conversation turns, message IDs, roles, selections, and replied-content UI from ChatGPT DOM nodes.
- **Decision:** Read ChatGPT state directly from the page DOM instead of using unofficial ChatGPT APIs.
- **Consequences:** The extension avoids depending on private network APIs or undocumented backend contracts. The tradeoff is sensitivity to ChatGPT DOM changes.
- **Files involved:** `src/content/dom-readers.js`, `src/content/app.js`, `src/content/constants.js`

## 9. Selectors Are Centralized in constants.js

- **Status:** Accepted
- **Context:** Shared ChatGPT selectors and timing constants are exported from `src/content/constants.js` and imported by content modules.
- **Decision:** Keep common selectors in `constants.js`.
- **Consequences:** Selector updates have a single primary location, which helps when ChatGPT changes markup. The tradeoff is that some one-off selectors may still live near specialized logic when centralizing them would reduce clarity.
- **Files involved:** `src/content/constants.js`, `src/content/app.js`, `src/content/dom-readers.js`, `src/content/diagnostics.js`, `src/content/observers.js`

## 10. Runtime State Is Centralized in state.js

- **Status:** Accepted
- **Context:** `src/content/state.js` exports the mutable content-script runtime state object used by rendering, navigation, persistence, diagnostics, and thread logic.
- **Decision:** Keep content-script runtime state centralized in `state.js`.
- **Consequences:** Modules share one source of truth for current mode, conversation data, timers, fail-safe status, and pending Ask state. The tradeoff is that callers must be disciplined because the state object is mutable and broadly shared.
- **Files involved:** `src/content/state.js`, `src/content/app.js`, `src/content/thread-model.js`, `src/content/persistence.js`, `src/content/diagnostics.js`

## 11. Thread Calculation Is Separated into thread-model.js

- **Status:** Accepted
- **Context:** Thread lookup, key derivation, current-thread context, parent-thread lookup, and subthread continuation helpers live in `src/content/thread-model.js`.
- **Decision:** Keep thread calculation separate from DOM rendering and event orchestration.
- **Consequences:** Thread behavior can be reasoned about in a focused module. The tradeoff is that it still depends on DOM-derived turn data and centralized runtime state.
- **Files involved:** `src/content/thread-model.js`, `src/content/app.js`, `src/content/dom-readers.js`, `src/content/state.js`

## 12. app.js Owns Tightly Coupled Orchestration

- **Status:** Current
- **Context:** `src/content/app.js` wires initialization, DOM events, rendering, source-link mutation, navigation, pending Ask reconciliation, storage refresh, and route observation.
- **Decision:** Keep tightly coupled content-script orchestration in `app.js` for now.
- **Consequences:** Related browser interactions remain in one place, which reduces cross-module coordination for behavior that changes together. The tradeoff is that `app.js` is large and should be split only when a boundary is clear enough to lower complexity.
- **Files involved:** `src/content/app.js`, `src/content/events.js`, `src/content/observers.js`, `src/content/persistence.js`, `src/content/thread-model.js`

## 13. Prefer Fail-Safe Behavior When ChatGPT DOM Is Not Recognized

- **Status:** Accepted
- **Context:** `probeDom()` sets `state.failSafe` when conversation messages exist but YACHT cannot recognize turn structure. Rendering then restores original page rendering and skips YACHT mutations while fail-safe is active.
- **Decision:** Prefer fail-safe behavior over risky DOM mutation when ChatGPT DOM is not recognized.
- **Consequences:** The extension is less likely to corrupt or hide ChatGPT UI after markup changes. The tradeoff is that YACHT features may temporarily disable themselves until selectors or DOM readers are updated.
- **Files involved:** `src/content/diagnostics.js`, `src/content/app.js`, `src/content/state.js`, `src/content/constants.js`
