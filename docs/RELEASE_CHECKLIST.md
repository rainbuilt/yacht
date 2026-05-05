# YACHT Release Checklist

## 1. Release Scope

- [ ] Confirm the release includes only intended code, manifest, popup, content, storage, and documentation changes.
- [ ] Identify whether the release changes ChatGPT DOM selectors, storage keys, IndexedDB schema, popup behavior, import/export behavior, or reset behavior.
- [ ] Record any behavior changes that users or maintainers need to know about.

## 2. Versioning

- [ ] Update `manifest.json` version if releasing.
- [ ] Keep `package.json` version aligned with `manifest.json` when this repository treats them as the same release version.
- [ ] Confirm the final version number is intentional before packaging or sharing the extension.

## 3. Static Validation

- [ ] Run `npm run validate`.
- [ ] Confirm `manifest_version` remains `3`.
- [ ] Confirm all manifest-referenced popup, background, content script, and CSS files exist.
- [ ] Run JavaScript syntax checks if practical, especially for changed files, for example `node --check path/to/file.js`.
- [ ] If practical, run `node scripts/smoke-extension.mjs` or `YACHT_HEADLESS=1 node scripts/smoke-extension.mjs`.

## 4. Manual Testing

- [ ] Reload the unpacked extension in Chrome from `chrome://extensions`.
- [ ] Confirm the extension loads without manifest errors.
- [ ] Open or reload `https://chatgpt.com/`.
- [ ] Refresh ChatGPT tabs that were already open before the extension reload.
- [ ] Verify header controls appear in the ChatGPT header.
- [ ] Verify creating a new Ask subthread from selected assistant text.
- [ ] Verify returning to source from Subthread Mode.
- [ ] Verify source links are restored around selected source text.
- [ ] Verify clicking source links opens the related subthread.
- [ ] Verify Main Mode and Subthread Mode visibility.
- [ ] Verify extension off mode restores ChatGPT UI and disables YACHT page modifications.

## 5. ChatGPT DOM Compatibility

- [ ] Verify current ChatGPT turn, message, assistant message, header, composer, send button, and replied-content selectors still match the live page.
- [ ] Verify header controls mount beside ChatGPT header controls, not inside message controls.
- [ ] Verify native Ask ChatGPT detection still works from selected assistant text.
- [ ] Verify source links do not break ChatGPT message layout.
- [ ] Verify fail-safe behavior leaves ChatGPT readable if the message DOM is not recognized.

## 6. Popup Testing

- [ ] Open the extension popup from Chrome's toolbar.
- [ ] Verify popup settings apply to an open ChatGPT tab.
- [ ] Verify the enabled/off setting persists after closing and reopening the popup.
- [ ] Verify source link color and underline settings persist after refreshing ChatGPT.
- [ ] Verify popup status, export, import, and reset controls render correctly.

## 7. Storage and Data Testing

- [ ] Verify no unexpected storage key changes.
- [ ] Verify no IndexedDB schema change without migration.
- [ ] Verify existing settings continue to load from `chrome.storage.local`.
- [ ] Verify existing anchors and threads continue to load from IndexedDB.
- [ ] Verify new source links persist after refreshing ChatGPT.
- [ ] Verify extension off/on changes do not delete user data.

## 8. Import/Export Testing

- [ ] Create at least one source link and change at least one popup setting before export.
- [ ] Verify export produces usable YACHT data.
- [ ] Verify import merge preserves existing data and adds imported data.
- [ ] Verify import replace removes previous data and restores only imported data.
- [ ] Verify imported source links, subthreads, and settings load after refreshing ChatGPT.
- [ ] Verify invalid or wrong-file imports fail without corrupting existing data.

## 9. Reset Testing

- [ ] Create source links and change settings before reset.
- [ ] Verify reset clears stored anchors and threads.
- [ ] Verify reset returns settings to expected defaults.
- [ ] Verify ChatGPT tabs refresh or recover into a clean YACHT state after reset.
- [ ] Verify reset does not leave stale source links or hidden turns on the page.

## 10. Manifest Review

- [ ] Verify `action.default_popup` points to the popup HTML.
- [ ] Verify `background.service_worker` points to the MV3 service worker.
- [ ] Verify content scripts still match only intended ChatGPT URLs.
- [ ] Verify requested permissions are still necessary.
- [ ] Verify host permissions are still necessary.
- [ ] Verify content modules listed in `web_accessible_resources`.
- [ ] Verify every dynamically imported content module is listed in `web_accessible_resources`.

## 11. Documentation Review

- [ ] Verify docs are updated when behavior or structure changes.
- [ ] Update DOM documentation when ChatGPT selector dependencies change.
- [ ] Update content module documentation when files move, modules are added, or responsibilities change.
- [ ] Update testing documentation when validation or smoke-test behavior changes.
- [ ] Update architecture documentation when manifest, background, popup, storage, or content loading changes.

## 12. Known Risks

- [ ] ChatGPT DOM changes can break selectors, Ask detection, source links, header controls, or message visibility.
- [ ] Source link restoration can fail if ChatGPT rewrites assistant message text or structure.
- [ ] Storage key or IndexedDB schema changes can strand existing user data without migration.
- [ ] Import replace can remove existing user data by design; verify the popup makes that choice clear.
- [ ] The smoke script uses a controlled DOM fixture and does not replace manual testing on the live ChatGPT page.

## 13. Final Checklist

- [ ] Release scope reviewed.
- [ ] Version reviewed and updated if releasing.
- [ ] `npm run validate` passed.
- [ ] JavaScript syntax checks run where practical.
- [ ] Unpacked extension reloaded in Chrome.
- [ ] Existing ChatGPT tabs refreshed.
- [ ] Manual ChatGPT flow tested.
- [ ] Popup settings tested.
- [ ] Export tested.
- [ ] Import merge tested.
- [ ] Import replace tested.
- [ ] Reset tested.
- [ ] Storage keys and IndexedDB schema reviewed.
- [ ] Manifest reviewed.
- [ ] Documentation reviewed.
- [ ] Known risks recorded.
