# YACHT Troubleshooting Guide

This guide is for beginner maintainers debugging the YACHT Chrome extension. Start with the symptom you see, then inspect the listed files. Avoid changing selectors, storage keys, or manifest paths until you have confirmed the failing step.

## First Five Checks

1. Reload the extension at `chrome://extensions`.
2. Refresh the ChatGPT tab.
3. Check DevTools console for the ChatGPT page, extension popup, and service worker.
4. Run `npm run validate`.
5. Check whether the ChatGPT DOM changed.

## 1. Extension Does Not Load

### Symptom

Chrome refuses to load the unpacked extension, shows a manifest error, or the extension icon/popup is missing.

### Likely causes

- `manifest.json` references a file that does not exist.
- The manifest is not valid Manifest V3 JSON.
- A content script, popup, or service worker path was renamed without updating the manifest.
- Chrome is loading a different directory than the repository root.

### Files to inspect

- `manifest.json`
- `src/background/service-worker.js`
- `src/content/content.js`
- `src/popup/popup.js`
- `scripts/smoke-extension.mjs`

### How to check

- Run `npm run validate`.
- In `chrome://extensions`, expand the YACHT error details.
- Confirm Chrome is loading the repository root, not `src/` or `docs/`.
- Check that `manifest.json` lists `src/content/content.js`, `src/content/content.css`, `src/background/service-worker.js`, and `src/popup/popup.html`.

### Common fixes

- Restore missing files or correct the paths in `manifest.json`.
- Keep `"manifest_version": 3`.
- Keep the background service worker path and `"type": "module"` in sync with the actual file.
- Reload the extension after every manifest change.

### What not to change casually

- Do not remove `storage`, `activeTab`, or `host_permissions` while debugging load problems.
- Do not change the extension match pattern away from `https://chatgpt.com/*` unless the target site intentionally changes.
- Do not add a build-step assumption unless the repository actually introduces a build step.

## 2. Content Script Does Not Run

### Symptom

The extension loads, but no YACHT controls, source links, diagnostics, or console messages appear on ChatGPT.

### Likely causes

- The current tab URL does not match `https://chatgpt.com/*`.
- `src/content/content.js` did not run.
- Dynamic import of `src/content/app.js` failed.
- The content script initialized before the page had the expected DOM and did not recover.

### Files to inspect

- `manifest.json`
- `src/content/content.js`
- `src/content/app.js`
- `src/content/constants.js`
- `src/content/observers.js`
- `src/popup/popup.js`

### How to check

- Open DevTools on the ChatGPT tab and look for `[Yacht] content script failed to load` or `[Yacht] initialization failed`.
- Open the popup. If it says `Refresh the ChatGPT tab to connect.`, `YACHT_PING` did not get a response from the content script.
- Confirm the ChatGPT tab starts with `https://chatgpt.com/`.
- Run `npm run validate`.

### Common fixes

- Reload the extension at `chrome://extensions`, then refresh ChatGPT.
- Fix manifest paths if validation reports missing files.
- If a new content module was added, add it to `web_accessible_resources`.
- Check whether selectors in `src/content/constants.js` still match the live ChatGPT DOM.

### What not to change casually

- Do not move initialization out of `src/content/content.js` into the manifest as a module content script.
- Do not bypass `src/content/app.js`; it owns event listeners, observers, settings, and rendering.
- Do not silence initialization errors without fixing the underlying runtime message or import failure.

## 3. Dynamic Import Fails

### Symptom

The console shows `[Yacht] content script failed to load`, often with an import or module URL error.

### Likely causes

- `src/content/app.js` is missing from `web_accessible_resources`.
- One of the modules imported by `app.js` is missing from `web_accessible_resources`.
- A file path or import path changed.
- A syntax error exists in `app.js` or one of its imported modules.

### Files to inspect

- `manifest.json`
- `src/content/content.js`
- `src/content/app.js`
- `src/content/constants.js`
- `src/content/dom-readers.js`
- `src/content/selection.js`
- `src/content/thread-model.js`
- `src/content/persistence.js`
- `src/content/diagnostics.js`
- `src/content/observers.js`

### How to check

- Confirm `src/content/content.js` imports `chrome.runtime.getURL("src/content/app.js")`.
- Confirm every content module imported by `src/content/app.js` is listed in `manifest.json` under `web_accessible_resources`.
- Run `node --check` on changed JavaScript files.
- Reload the extension and refresh ChatGPT after changing manifest resources.

### Common fixes

- Add missing imported content modules to `web_accessible_resources`.
- Correct relative import paths in `src/content/app.js` and helper modules.
- Fix syntax errors reported by DevTools or `node --check`.

### What not to change casually

- Do not replace dynamic import with top-level static imports in `src/content/content.js`.
- Do not expose broad file globs in `web_accessible_resources` when a precise file list is enough.
- Do not remove existing content modules from `web_accessible_resources` just because they are not imported by `content.js` directly.

## 4. Header Controls Do Not Appear

### Symptom

The YACHT toggle and return-to-source control are missing from the ChatGPT header.

### Likely causes

- Header selectors no longer match ChatGPT.
- Header mounting is still waiting for the initial delay.
- The content script did not initialize.
- The extension is in fail-safe mode after failing to recognize the message DOM.

### Files to inspect

- `src/content/app.js`
- `src/content/constants.js`
- `src/content/diagnostics.js`
- `src/content/observers.js`
- `src/content/content.css`
- `scripts/smoke-extension.mjs`

### How to check

- In DevTools, run `document.querySelector(".yacht-header-controls")`.
- Check `SELECTORS.header`, `SELECTORS.headerActions`, `SELECTORS.headerActionsFallback`, `SELECTORS.shareButton`, and `SELECTORS.optionsButton`.
- Look for a `.yacht-diagnostic` banner.
- Wait a few seconds after refresh; header mounting uses a delay from `HEADER_MOUNT_DELAY_MS`.

### Common fixes

- Update only the broken header selectors in `src/content/constants.js` after confirming the live DOM.
- Make sure `observeDom()` watches the current header root.
- Verify CSS does not hide `.yacht-header-controls`.

### What not to change casually

- Do not mount controls into message-level action buttons.
- Do not remove the mount delay unless you understand why ChatGPT header rendering needs it.
- Do not disable fail-safe just to force controls to appear.

## 5. Header Controls Appear in the Wrong Place

### Symptom

The YACHT controls show up near a message action, in the wrong header area, or after the Share/options buttons.

### Likely causes

- Header action selectors match the wrong container.
- ChatGPT changed the order or names of header buttons.
- `findHeaderMountPoint()` cannot find the real Share/options button and falls back to `parent.firstChild`.

### Files to inspect

- `src/content/app.js`
- `src/content/constants.js`
- `src/content/content.css`
- `scripts/smoke-extension.mjs`

### How to check

- Inspect the parent of `.yacht-header-controls` in DevTools.
- Compare it with `#conversation-header-actions` and `[data-testid="thread-header-right-actions"]`.
- Check whether the control is inserted before `SELECTORS.shareButton` or `SELECTORS.optionsButton`.
- Run `node scripts/smoke-extension.mjs` if Chrome is available.

### Common fixes

- Narrow the header action selector so it targets the page header only.
- Update `shareButton` or `optionsButton` selectors after confirming real ChatGPT markup.
- Keep CSS alignment simple: `.yacht-header-controls` should remain inline-flex beside ChatGPT controls.

### What not to change casually

- Do not hard-code screen coordinates.
- Do not use broad button text matching for placement.
- Do not make the controls fixed-position unless the product behavior intentionally changes.

## 6. Source Links Do Not Appear

### Symptom

After creating a subthread, the original selected assistant text is not wrapped in a YACHT source link.

### Likely causes

- No anchor/thread was persisted.
- The selected text cannot be restored in the current message.
- Message keys changed between capture and render.
- Settings are disabled or fail-safe mode is active.

### Files to inspect

- `src/content/app.js`
- `src/content/selection.js`
- `src/content/dom-readers.js`
- `src/content/thread-model.js`
- `src/content/persistence.js`
- `src/content/constants.js`
- `src/background/service-worker.js`

### How to check

- Open the popup and confirm the extension is enabled.
- In the ChatGPT console, check for `[Yacht] failed to render source link` or skipped source-link debug messages.
- Inspect whether `.yacht-source-link` exists in the DOM.
- Check `readTurnInfos()` assumptions: turns need `section[data-testid^="conversation-turn-"][data-turn]` and messages need `data-message-author-role`.
- Verify the background service worker can handle `YACHT_UPSERT_ANCHOR` and `YACHT_UPSERT_THREAD`.

### Common fixes

- Fix changed message/turn selectors in `src/content/constants.js`.
- Fix selection capture if assistant messages no longer use `data-message-author-role="assistant"`.
- Keep anchor restore logic based on offsets, selected text, prefix, and suffix.
- Reload ChatGPT after changing selectors.

### What not to change casually

- Do not wrap arbitrary text if restore confidence is low.
- Do not ignore `state.settings.enabled` or `state.failSafe`.
- Do not store anchor/thread data directly from content code; use background runtime messages.

## 7. Source Links Appear but Click Does Nothing

### Symptom

The selected text is styled as a source link, but clicking it does not open a subthread or chooser.

### Likely causes

- The link has an `anchorId` that has no matching thread.
- Click or pointer events are intercepted before YACHT handles them.
- `sourceAnchorsFromEvent()` cannot resolve the clicked anchor.
- A previous suppress timer is active briefly after pointer handling.
- Pointer-down on an actual `.yacht-source-link` should not open the subthread. Direct source-link navigation is handled by click so the linked source text remains selectable for another Ask ChatGPT question.
- Dragging across an actual `.yacht-source-link` should suppress the follow-up click event when the pointer moved or the selected link text changed.
- Source links should have `draggable="false"` and `user-select: text` so browser-native link dragging does not block text selection.
- Clicks in overlapping source-link ranges should collect all anchors under the point and show all related subthreads in the chooser.

### Files to inspect

- `src/content/app.js`
- `src/content/thread-model.js`
- `src/content/events.js`
- `src/content/content.css`
- `src/background/service-worker.js`

### How to check

- Inspect the clicked element and confirm it has `.yacht-source-link` and `data-anchor-id`.
- Check whether `threadsForAnchor(anchorId)` would have at least one thread in current state.
- Try clicking after a short pause to rule out suppression timing.
- Try drag-selecting from outside a source link and releasing inside it. If the subthread opens after mouseup, inspect `finishSourcePointerGesture()` and `shouldSuppressSourceLinkClick()`.
- For overlapping links, inspect `findAnchorsAtPoint()` and confirm it returns every anchor whose rendered link or restored range contains the click point.
- Inspect the source link and computed style. It should have `draggable="false"` and `user-select: text`.
- Watch the console for runtime or persistence errors.

### Common fixes

- Repair anchor/thread persistence if records are missing.
- Fix event listener registration in `registerDocumentEvents()`.
- Fix `findAnchor()` or `threadsForAnchor()` data loading if the current conversation data is stale.
- If multiple threads exist, verify `.yacht-popover__item` is created.

### What not to change casually

- Do not remove `preventDefault()`/`stopPropagation()` without checking ChatGPT native link behavior.
- Do not make links navigate to real URLs; they are in-page controls.
- Do not bypass the multiple-thread chooser when more than one thread uses the same anchor.

## 8. Subthread Messages Are Not Hidden in Main Mode

### Symptom

After returning to Main Mode, Ask ChatGPT subthread turns remain visible in the main conversation.

### Likely causes

- Thread message keys are not being derived correctly.
- `state.mode` did not return to `main`.
- `applyMessageVisibility()` did not run after navigation or data changes.
- ChatGPT changed turn/message attributes used by `readTurnInfos()`.

### Files to inspect

- `src/content/app.js`
- `src/content/thread-model.js`
- `src/content/dom-readers.js`
- `src/content/constants.js`
- `src/content/observers.js`
- `src/content/persistence.js`

### How to check

- Inspect visible turns for the `.yacht-hidden-turn` class.
- Confirm `state.mode` is `main` through the `YACHT_PING` popup response if needed.
- Check whether `buildThreadKeyMap()` includes the subthread user and assistant message keys.
- Confirm the current page is the same conversation ID used by stored thread records.

### Common fixes

- Fix turn/message selectors first if keys are missing or unstable.
- Ensure thread records include `rootUserMessageKey` and `messageKeys`.
- Let `repairThreadMessageMappings()` update stale mappings instead of hand-editing stored records.
- Ensure mutation observation still triggers render passes when ChatGPT appends turns.

### What not to change casually

- Do not hide messages by text content.
- Do not make all user turns hidden in Main Mode.
- Do not clear all extension data unless specifically testing reset behavior.

## 9. Main Conversation Messages Are Hidden Incorrectly

### Symptom

Normal main conversation messages disappear, or Subthread Mode hides the wrong turns.

### Likely causes

- Message keys collide or change because ChatGPT removed `data-message-id`.
- A thread record has incorrect `messageKeys`.
- `getCurrentMainThreadKeys()` or `getCurrentSubthreadKeys()` is using bad turn data.
- A parent/child subthread relationship was derived incorrectly.

### Files to inspect

- `src/content/thread-model.js`
- `src/content/dom-readers.js`
- `src/content/app.js`
- `src/content/constants.js`
- `src/content/persistence.js`

### How to check

- Inspect each `section[data-testid^="conversation-turn-"]` and its `data-message-author-role`.
- Check whether hidden turns have `.yacht-hidden-turn`.
- Compare stored thread roots with visible user turns.
- Look for fallback keys generated from role, index, and text hash; these are less stable than `data-message-id`.

### Common fixes

- Update selectors so `readTurnInfos()` finds stable ChatGPT message IDs again.
- Fix parent thread detection in `findDirectParentThread()` only after confirming nested thread behavior.
- Re-run source-link and return-to-source manual checks after changing key logic.

### What not to change casually

- Do not remove `.yacht-hidden-turn` globally as a workaround.
- Do not change message-key format without a migration plan for saved data.
- Do not treat every assistant message after an Ask as part of the same thread if a new user turn has started.

## 10. Ask ChatGPT Click Does Not Create a Thread

### Symptom

Selecting assistant text and clicking Ask ChatGPT creates a ChatGPT reply, but YACHT does not enter Subthread Mode or save a thread.

### Likely causes

- Selection capture did not record `state.lastSelection`.
- The clicked button no longer looks like `Ask ChatGPT` or `Ask`.
- The generated user turn does not include the expected replied-content reference.
- Pending ask reconciliation timed out or discarded an unmatched user turn.

### Files to inspect

- `src/content/app.js`
- `src/content/selection.js`
- `src/content/dom-readers.js`
- `src/content/constants.js`
- `src/content/persistence.js`
- `src/background/service-worker.js`

### How to check

- Confirm the selected text is inside one assistant message.
- Check that the selected text has at least two normalized characters.
- Inspect the new user turn for a button containing `p.line-clamp-3`, which `getUserReferenceTexts()` expects.
- Watch for `[Yacht] failed to persist new Ask thread`.

### Common fixes

- Update `SELECTORS.userReferenceButton` or `getUserReferenceTexts()` if ChatGPT changed the replied-content markup.
- Update Ask button detection only after checking the button text, title, and aria-label.
- Fix background message handling if `YACHT_UPSERT_ANCHOR` or `YACHT_UPSERT_THREAD` fails.

### What not to change casually

- Do not create threads from plain user messages with no replied-content reference.
- Do not remove the pending ask timeout/grace behavior without understanding false positives.
- Do not allow selections that cross multiple assistant messages unless thread anchoring is redesigned.

## 11. Return to Source Does Not Work

### Symptom

The header return button is missing, clicking it does nothing, or it returns to the wrong conversation level.

### Likely causes

- The current mode is not `subthread`.
- The current thread cannot be found in loaded data.
- The anchor for the thread cannot be found or restored.
- Nested parent thread detection is wrong.
- The scroll target is hidden or not yet rendered.

### Files to inspect

- `src/content/app.js`
- `src/content/thread-model.js`
- `src/content/dom-readers.js`
- `src/content/persistence.js`
- `src/content/constants.js`

### How to check

- Confirm `[data-yacht-control="back"]` exists and is not hidden.
- Confirm the popup ping reports `mode: "subthread"` and a current thread.
- Check whether the source link or source message exists in the DOM.
- For nested subthreads, verify `parentThreadId` or `findDirectParentThread()` can identify the parent.

### Common fixes

- Fix the stored thread's parent relationship if nested subthreads are wrong.
- Fix anchor restoration if the source text exists but cannot be found.
- Keep `scheduleSaveNavigationState()` after mode changes.
- Keep post-render scrolling delayed enough for ChatGPT rendering.

### What not to change casually

- Do not always return to Main Mode; nested subthreads need to return to their parent thread.
- Do not scroll to hidden turns.
- Do not remove navigation-state saving unless persistence behavior changes intentionally.

## 12. Popup Cannot Connect to the Page

### Symptom

The popup says `Open ChatGPT to use the navigator.` or `Refresh the ChatGPT tab to connect.` even though ChatGPT is open.

### Likely causes

- The active tab is not `https://chatgpt.com/`.
- The content script did not load in the active tab.
- `chrome.tabs.sendMessage` to `YACHT_PING` failed.
- The page was opened before the extension was reloaded.

### Files to inspect

- `src/popup/popup.js`
- `src/content/app.js`
- `src/content/content.js`
- `manifest.json`

### How to check

- Confirm the active tab URL starts with `https://chatgpt.com/`.
- Refresh the ChatGPT tab after reloading the extension.
- Open the ChatGPT console and check for content-script load errors.
- In `src/popup/popup.js`, check `CHATGPT_URL_PATTERNS`, `pingContentScript()`, and `renderActiveTabState()`.

### Common fixes

- Reload the extension, then refresh the ChatGPT tab.
- Fix content script injection or dynamic import failures first.
- Update URL matching only if ChatGPT's supported URL origin intentionally changes.

### What not to change casually

- Do not make the popup claim it is connected without a successful `YACHT_PING`.
- Do not broaden URL matching to unrelated websites.
- Do not move tab messaging into the background unless the popup workflow is redesigned.

## 13. Settings Do Not Apply

### Symptom

The popup saves settings, but the ChatGPT page does not reflect enabled state, source-link color, or underline changes.

### Likely causes

- Background settings save failed.
- Popup could not refresh the active content script.
- Content did not receive `chrome.storage.onChanged`.
- `applyStyleSettings()` did not update CSS variables or link datasets.

### Files to inspect

- `src/popup/popup.js`
- `src/background/service-worker.js`
- `src/content/app.js`
- `src/content/persistence.js`
- `src/content/constants.js`
- `src/content/content.css`

### How to check

- Check popup action status for save errors or fallback warnings.
- Check service worker console for `[Yacht] background error`.
- Inspect `chrome.storage.local` for `yacht.settings`.
- On the page, inspect `document.documentElement.style.getPropertyValue("--yacht-link-color")`.
- Inspect a `.yacht-source-link` for `data-yacht-underline`.

### Common fixes

- Fix `YACHT_SAVE_SETTINGS` in the background if saves fail.
- Fix `YACHT_REFRESH_FROM_STORAGE` handling in `src/content/app.js`.
- Keep `SETTINGS_KEY` consistent between content and background.
- Fix CSS selectors for `.yacht-source-link[data-yacht-underline="false"]` only if the dataset name changed.

### What not to change casually

- Do not create a second settings key.
- Do not store popup-only settings under `yachtSettings` except as the existing fallback path.
- Do not require a full browser restart for normal settings changes.

## 14. Import/Export Fails

### Symptom

Export does not download data, import shows an error, imported links do not return, or settings are not restored.

### Likely causes

- Background import/export message failed.
- Import JSON is invalid or has an unsupported `schemaVersion`.
- IndexedDB transaction failed.
- Popup fallback storage path was used because background did not respond.

### Files to inspect

- `src/popup/popup.js`
- `src/background/service-worker.js`
- `src/content/persistence.js`
- `src/content/constants.js`

### How to check

- Check popup action status for `Export failed:` or `Import failed:`.
- Validate the JSON file manually and confirm it is an object.
- Confirm exported data has `schemaVersion`, `settings`, `anchors`, and `threads`.
- Check service worker console for IndexedDB or transaction errors.
- Confirm `SCHEMA_VERSION` matches between content constants and background.

### Common fixes

- Fix `YACHT_EXPORT_DATA` or `YACHT_IMPORT_DATA` handling in `src/background/service-worker.js`.
- Use a valid YACHT export file for import.
- Keep import mode behavior clear: `merge` adds records, `replace` clears anchors and threads before import.
- Refresh ChatGPT after import so content reloads data.

### What not to change casually

- Do not accept unknown schema versions without a migration.
- Do not clear `chrome.storage.local` during normal merge import.
- Do not change IndexedDB store names without a migration plan.

## 15. Reset Does Not Clear Expected Data

### Symptom

After using reset, source links, subthreads, navigation state, or old settings still appear.

### Likely causes

- Background reset did not run.
- Current page state did not refresh after reset.
- Reset clears anchors, threads, and settings, but content-side navigation state may still need refresh.
- Popup fallback reset path ran instead of background reset.

### Files to inspect

- `src/popup/popup.js`
- `src/background/service-worker.js`
- `src/content/app.js`
- `src/content/persistence.js`
- `src/content/constants.js`

### How to check

- Confirm the reset confirmation was accepted.
- Check popup action status for `All data reset.` or `Reset failed:`.
- Refresh the ChatGPT tab after reset.
- Check whether `.yacht-source-link` and `.yacht-hidden-turn` remain after refresh.
- Check service worker reset code for `YACHT_RESET_ALL_DATA`.

### Common fixes

- Fix `resetAllData()` in the background if anchors or threads remain.
- Ensure popup calls `YACHT_REFRESH_FROM_STORAGE` after reset.
- Ensure content handles refresh by loading settings, conversation data, and navigation state.
- Use reset troubleshooting only when intentionally clearing YACHT data.

### What not to change casually

- Do not tell users to delete all browser data for a YACHT reset issue.
- Do not clear unrelated extension or site data outside the reset path.
- Do not make reset silently skip the confirmation dialog.

## 16. Fail-safe Diagnostic Appears

### Symptom

A banner says `YACHT is in fail-safe mode because the ChatGPT message DOM was not recognized.`

### Likely causes

- ChatGPT still has message elements, but YACHT cannot read turns.
- `SELECTORS.message` matches, while `SELECTORS.turn` no longer matches.
- ChatGPT changed conversation markup.

### Files to inspect

- `src/content/diagnostics.js`
- `src/content/constants.js`
- `src/content/dom-readers.js`
- `src/content/app.js`

### How to check

- In DevTools, compare `document.querySelector(SELECTORS.message)` with `document.querySelectorAll(SELECTORS.turn).length`.
- Inspect the current ChatGPT conversation DOM around user and assistant messages.
- Confirm the page URL matches a conversation path like `/c/...`.
- Check whether source links and hiding are disabled; that is expected in fail-safe mode.

### Common fixes

- Update turn selectors in `src/content/constants.js` after confirming the new DOM.
- Update `readTurnInfos()` only if the structure of a turn/message relationship changed.
- Keep the diagnostic visible until the DOM is recognized again.

### What not to change casually

- Do not remove fail-safe mode.
- Do not force source-link wrapping or message hiding when turns cannot be read.
- Do not change diagnostics based on one partial loading state; refresh and inspect a loaded conversation first.

## 17. Smoke Script Fails Before Assertions

### Symptom

`node scripts/smoke-extension.mjs` fails before testing header controls, source links, popup behavior, or service worker assertions.

### Likely causes

- Chrome is not installed at `/usr/bin/google-chrome-stable`.
- `CHROME_BIN` is not set for the local machine.
- Chrome cannot start with DevTools pipe or remote debugging.
- The unpacked extension failed to load before the browser fixture was created.
- Local sandbox, display, or container restrictions prevent Chrome startup.

### Files to inspect

- `scripts/smoke-extension.mjs`
- `manifest.json`
- `package.json`

### How to check

- Run `CHROME_BIN=/path/to/chrome YACHT_HEADLESS=1 node scripts/smoke-extension.mjs`.
- Read the first error. `Chrome DevTools endpoint did not start` usually points to environment setup.
- `Extensions.loadUnpacked failed` usually points to manifest or extension load problems.
- Run `npm run validate` before the smoke script.

### Common fixes

- Set `CHROME_BIN` to a real Chrome executable.
- Use `YACHT_HEADLESS=1` in environments without a display.
- Fix manifest validation errors before rerunning smoke.
- Separate environment failures from assertion failures after the fixture loads.

### What not to change casually

- Do not weaken smoke assertions to hide a startup problem.
- Do not assume the smoke script is an npm script; currently it is run directly with Node.
- Do not edit extension behavior to work around a missing local Chrome binary.

## 18. ChatGPT Changed Its DOM

### Symptom

Several YACHT features fail at once after ChatGPT updates: controls move, selections stop mapping, source links disappear, hiding is wrong, or fail-safe appears.

### Likely causes

- ChatGPT renamed data attributes used by YACHT selectors.
- Turn/message grouping changed.
- Header buttons moved to a different container.
- Replied-content markup changed.
- Native Ask ChatGPT button labels or structure changed.

### Files to inspect

- `src/content/constants.js`
- `src/content/dom-readers.js`
- `src/content/selection.js`
- `src/content/app.js`
- `src/content/thread-model.js`
- `src/content/diagnostics.js`
- `src/content/observers.js`
- `scripts/smoke-extension.mjs`

### How to check

- Inspect a real ChatGPT conversation, not only the smoke fixture.
- Verify these selectors first: header, header actions, share/options buttons, turns, messages, user reference buttons, replied content, composer, and send button.
- Compare a user turn, assistant turn, selected assistant text, and replied-content user turn against what `readTurnInfos()` and `getUserReferenceTexts()` expect.
- Run the smoke script after selector changes, then manually test real ChatGPT because the fixture cannot cover every live DOM change.

### Common fixes

- Update selectors in `src/content/constants.js` with the smallest confirmed change.
- Update DOM readers only when selector changes are not enough.
- Update the smoke fixture if the intended supported DOM shape changes.
- Retest header placement, Ask thread creation, Main Mode hiding, Subthread Mode hiding, source-link click, return-to-source, popup settings, import/export, and reset.

### What not to change casually

- Do not broaden selectors so they match unrelated ChatGPT controls.
- Do not rely only on visible text when stable attributes exist.
- Do not disable diagnostics, source restore checks, or message-key safeguards to pass a changed DOM.
