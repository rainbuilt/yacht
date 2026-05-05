# YACHT Runtime Flows

This document explains the main runtime flows in the current extension code. It follows what the code does today, not every behavior described in product planning.

## 1. Extension Startup

1. Trigger
   The content script calls `initialize` when it loads on a ChatGPT page.

2. Main functions involved
   `initialize`, `loadSettings`, `loadConversationData`, `loadNavigationState`, `registerDocumentEvents`, `observeDom`, `observeRouteChanges`, `refreshRepliedContentState`, `render`, `probeDom`

3. State fields touched
   `state.initialized`, `state.settings`, `state.data`, `state.mode`, `state.currentThreadId`, `state.subthreadKnownTurnKeys`, `state.subthreadContinuationArmedUntil`, `state.repliedContentActive`, `state.failSafe`, `state.diagnostic`

4. Persistent data touched
   Settings are read through `YACHT_GET_SETTINGS`. Conversation anchors and threads are read through `YACHT_GET_CONVERSATION_DATA`. Navigation state is read from `chrome.storage.local` under `yacht.nav.<conversationId>`.

5. DOM changes made
   `render` may add header controls, source links, hidden-turn classes, and diagnostics. It also starts DOM observation after each render pass.

6. Failure or fallback behavior
   If storage initialization fails, `initialize` logs the error and shows the diagnostic message `YACHT could not initialize local extension storage.` Event listeners and rendering are still registered.

## 2. Loading Settings and Conversation Data

1. Trigger
   Startup, route changes, enabling the extension, popup refresh messages, or storage changes can load settings and conversation data.

2. Main functions involved
   `loadSettings`, `loadConversationData`, `loadNavigationState`, `sendRuntime`, `currentNavKey`, `findThread`, `resetThreadNavigationState`

3. State fields touched
   `state.settings`, `state.data.anchors`, `state.data.threads`, `state.mode`, `state.currentThreadId`, `state.subthreadKnownTurnKeys`, `state.subthreadContinuationArmedUntil`

4. Persistent data touched
   The background reads `yacht.settings` from `chrome.storage.local`. It reads anchors and threads from IndexedDB object stores named `anchors` and `threads`. Content reads navigation from `chrome.storage.local`.

5. DOM changes made
   Loading itself does not change the DOM. Later scheduled render passes apply the visible result.

6. Failure or fallback behavior
   `sendRuntime` throws if the background response is not `ok`. `loadNavigationState` falls back to main mode if stored subthread navigation points to a missing thread.

## 3. Reading ChatGPT Turns

1. Trigger
   Rendering, selection capture, pending ask reconciliation, thread visibility, source-link restoration, route-related rendering, and continuation handling all call `readTurnInfos`.

2. Main functions involved
   `readTurnInfos`, `getMessageKey`, `findMessageByKey`, `findTurnInfoForMessageKey`

3. State fields touched
   `readTurnInfos` does not mutate state by itself. Callers use its result to update fields such as `state.pendingAsk`, `state.data.threads`, `state.failSafe`, and visibility classes.

4. Persistent data touched
   None directly.

5. DOM changes made
   None directly. It reads ChatGPT turn and message elements.

6. Failure or fallback behavior
   If a message has `data-message-id`, `getMessageKey` uses `message:<id>`. Otherwise it builds a fallback key from role, index, and a hash of message text.

## 4. Capturing a Text Selection

1. Trigger
   `registerDocumentEvents` listens for `selectionchange` and calls `captureSelection` after a short timeout.

2. Main functions involved
   `captureSelection`, `offsetsForRange`, `readTurnInfos`, `getMessageKey`, `textFromNodes`, `hashString`, `normalizeText`

3. State fields touched
   `state.lastSelection`, `state.suppressSelectionCaptureUntil`

4. Persistent data touched
   None. Captured selections are in memory until they become anchors.

5. DOM changes made
   None.

6. Failure or fallback behavior
   The selection is ignored if capture is suppressed, collapsed, outside an assistant message, crosses messages, is shorter than two normalized characters, or offsets cannot be computed. If no turn info is found, a fallback message key is created.

## 5. Creating a Pending Ask

1. Trigger
   Clicking a native Ask-like button, clicking a control after replied content appears, or `refreshRepliedContentState` seeing active replied content after a selection.

2. Main functions involved
   `createPendingAsk`, `readTurnInfos`, `isMessageKeyInCurrentThread`, `buildAnchorFromSelection`, `schedulePendingReconcile`

3. State fields touched
   `state.pendingAsk`, `state.lastSelection`, `state.mode`, `state.currentThreadId`, `state.failSafe`, `state.autoContextInProgress`, `state.suppressAskButtonCaptureUntil`, `state.suppressRepliedContentAskUntil`

4. Persistent data touched
   None immediately. Persistence happens later in `reconcilePendingAsk`.

5. DOM changes made
   None immediately.

6. Failure or fallback behavior
   No pending ask is created when the extension is disabled, fail-safe is active, no valid selection exists, auto context is in progress, capture is suppressed, or the selected source message is not in the current visible thread. In that last case, `state.lastSelection` is cleared.

## 6. Reconciling a Pending Ask into an Anchor and Thread

1. Trigger
   `schedulePendingReconcile` runs timed retries. DOM mutations also call `reconcilePendingAsk`.

2. Main functions involved
   `reconcilePendingAsk`, `isPendingAskOwnerActive`, `isAskUserTurnForAnchor`, `getUserReferenceTexts`, `getUserQuestionText`, `persistAnchor`, `persistThread`, `navigateToThread`, `readTurnInfos`

3. State fields touched
   `state.pendingAsk`, `state.data.anchors`, `state.data.threads`, `state.mode`, `state.currentThreadId`, `state.subthreadKnownTurnKeys`, `state.subthreadContinuationArmedUntil`

4. Persistent data touched
   `persistAnchor` sends `YACHT_UPSERT_ANCHOR` to IndexedDB. `persistThread` sends `YACHT_UPSERT_THREAD` to IndexedDB. Navigation state is later saved by `navigateToThread`.

5. DOM changes made
   `navigateToThread` schedules render and scroll. The render pass hides non-current messages and later renders source links.

6. Failure or fallback behavior
   If the pending ask owner mode or thread changes before a root user turn is found, the pending ask is cleared. If no matching Ask reference appears, plain unmatched user turns are given a short grace period and the pending ask times out after `PENDING_ASK_TIMEOUT_MS`. Persistence errors are logged.

## 7. Rendering Source Links

1. Trigger
   `render` calls `applySourceLinks` when the extension is enabled and not in fail-safe mode.

2. Main functions involved
   `applySourceLinks`, `anchorsWithThreads`, `sourceLinkSignature`, `hasRenderedSourceLinks`, `clearSourceLinks`, `restoreAnchorRange`, `findSourceMessage`, `findRangeByTextContext`, `wrapTextOffsets`, `createSourceLink`, `findAnchorAtPoint`

3. State fields touched
   `state.renderedSourceSignature`, `state.settings.sourceLinkStyle`, `state.data.anchors`, `state.data.threads`, `state.failSafe`

4. Persistent data touched
   None. It reads anchors and threads already loaded into memory.

5. DOM changes made
   Existing `.yacht-source-link` wrappers are removed and rebuilt when needed. Matching selected text is wrapped in `<a class="yacht-source-link">` elements with `data-anchor-id` and underline styling data.

6. Failure or fallback behavior
   If disabled, fail-safe, or no anchors with threads exist, source links are cleared. If exact offsets no longer match, the code tries contextual text matching. Low-confidence or failed restores are skipped and logged.

## 8. Main Mode Message Visibility

1. Trigger
   `render` calls `applyMessageVisibility` in main mode.

2. Main functions involved
   `applyMessageVisibility`, `buildThreadKeyMap`, `deriveThreadMessageKeys`, `repairThreadMessageMappings`, `reconcileSubthreadContinuations`, `clearMessageVisibility`

3. State fields touched
   `state.mode`, `state.data.threads`, `state.currentThreadId`, `state.failSafe`

4. Persistent data touched
   `repairThreadMessageMappings` may call `persistThread` if stored message-key mappings differ from derived mappings.

5. DOM changes made
   Turns that belong to any stored subthread receive the `yacht-hidden-turn` class. Main conversation turns remain visible.

6. Failure or fallback behavior
   If there are no stored threads, visibility is cleared. If the extension is disabled or fail-safe is active, messages are not hidden.

## 9. Subthread Mode Message Visibility

1. Trigger
   `navigateToThread` enters subthread mode and schedules render. `render` then calls `applyMessageVisibility`.

2. Main functions involved
   `navigateToThread`, `applyMessageVisibility`, `buildThreadKeyMap`, `effectiveMessageKeysForThread`, `deriveThreadMessageKeys`, `setSubthreadBaselineFromCurrentTurns`

3. State fields touched
   `state.mode`, `state.currentThreadId`, `state.subthreadKnownTurnKeys`, `state.subthreadContinuationArmedUntil`, `state.data.threads`

4. Persistent data touched
   `scheduleSaveNavigationState` stores the current mode and thread id in `chrome.storage.local`.

5. DOM changes made
   Turns not in the current thread receive `yacht-hidden-turn`. Current thread turns remain visible. Header controls update so the back button is shown.

6. Failure or fallback behavior
   `navigateToThread` does nothing if the thread id is not found. If the extension is disabled or fail-safe is active, visibility is restored.

## 10. Returning to Source

1. Trigger
   The user clicks the YACHT header back button or a ChatGPT user reference button while in subthread mode.

2. Main functions involved
   `returnToSource`, `findThread`, `findAnchor`, `findDirectParentThread`, `setSubthreadBaselineFromCurrentTurns`, `scheduleSaveNavigationState`, `scheduleRender`, `queueScrollToAnchor`

3. State fields touched
   `state.mode`, `state.currentThreadId`, `state.subthreadKnownTurnKeys`, `state.subthreadContinuationArmedUntil`, `state.scrollToken`, `state.scrollTimers`

4. Persistent data touched
   Navigation state is saved to `chrome.storage.local`.

5. DOM changes made
   A render pass updates hidden-turn classes and header controls. A queued scroll tries to bring the source link or source message into view.

6. Failure or fallback behavior
   If the current thread is missing, the code returns to main mode. If there is a parent thread, it navigates to that parent instead of main mode. If the source link is not visible, scrolling falls back to the source message when possible.

## 11. Continuing a Subthread

1. Trigger
   While in subthread mode, composer pointer, input, or keydown events call `armSubthreadContinuation`. Later DOM mutations call `reconcileSubthreadContinuations`.

2. Main functions involved
   `armSubthreadContinuation`, `reconcileSubthreadContinuations`, `effectiveMessageKeysForThread`, `allOtherThreadMessageKeys`, `deriveThreadMessageKeys`, `persistThread`, `scheduleRender`

3. State fields touched
   `state.subthreadContinuationArmedUntil`, `state.subthreadKnownTurnKeys`, `state.pendingAsk`, `state.data.threads`, `state.mode`, `state.currentThreadId`

4. Persistent data touched
   Updated thread `messageKeys` and `assistantMessageKeys` are saved through `persistThread`.

5. DOM changes made
   After persistence, render updates message visibility so new continuation turns stay visible in the current subthread.

6. Failure or fallback behavior
   Continuation is ignored when disabled, in fail-safe mode, outside subthread mode, missing the current thread, a pending ask exists, the arm window has expired, or new turns belong to another thread.

## 12. Auto Context Attachment

1. Trigger
   Clicking the send button or pressing plain Enter in the composer can run auto context attachment before sending.

2. Main functions involved
   `shouldAttachAutoContext`, `handleSendWithAutoContext`, `ensureAutoContextForCurrentThread`, `getCurrentThreadContext`, `findLastAnswerContextRange`, `selectRangeForNativeAsk`, `findNativeAskButton`, `waitForElement`, `focusComposer`

3. State fields touched
   `state.autoContextInProgress`, `state.suppressSelectionCaptureUntil`, `state.suppressAskButtonCaptureUntil`, `state.suppressRepliedContentAskUntil`, `state.allowNextSendClickUntil`, `state.pendingAsk`

4. Persistent data touched
   None directly.

5. DOM changes made
   The code programmatically selects the last answer text range, dispatches selection and mouseup events, clicks ChatGPT's native Ask button if found, clears the selection, focuses the composer, and then clicks send again.

6. Failure or fallback behavior
   Auto context only runs when enabled, not fail-safe, not already in progress, no replied content is active, and the current thread is not at the latest conversation tail. Errors are logged at debug level, and the code still allows the follow-up send click path.

## 13. Route Change Handling

1. Trigger
   `observeRouteChanges` polls once per second and compares `getConversationId()` to `state.conversationId`.

2. Main functions involved
   `observeRouteChanges`, `getConversationId`, `loadConversationData`, `loadNavigationState`, `scheduleRender`

3. State fields touched
   `state.conversationId`, `state.pendingAsk`, `state.lastSelection`, `state.subthreadKnownTurnKeys`, `state.subthreadContinuationArmedUntil`, `state.data`, `state.mode`, `state.currentThreadId`

4. Persistent data touched
   Conversation data is loaded from IndexedDB for the new conversation id. Navigation state is loaded from `chrome.storage.local` for the new conversation id.

5. DOM changes made
   A render pass updates source links, message visibility, diagnostics, and header controls for the new route.

6. Failure or fallback behavior
   If the conversation id has not changed, nothing happens. The route handler does not include a local catch around its async load path.

## 14. Storage Change Handling

1. Trigger
   `chrome.storage.onChanged` fires for `chrome.storage.local`, especially when `yacht.settings` changes.

2. Main functions involved
   `handleStorageChange`, `mergeSettings`, `loadConversationData`, `loadNavigationState`, `scheduleRenderPasses`

3. State fields touched
   `state.settings`, `state.pendingAsk`, `state.lastSelection`, `state.data`, `state.mode`, `state.currentThreadId`

4. Persistent data touched
   Reads the new settings value from the storage change event. If the extension has just been enabled, reloads IndexedDB conversation data and navigation state.

5. DOM changes made
   Scheduled render passes apply updated styles, visibility, header controls, or restore original rendering when disabled.

6. Failure or fallback behavior
   Non-local changes and changes outside `yacht.settings` are ignored. When enabling and reload fails, the error is logged and render passes are still scheduled.

## 15. Popup Settings Update

1. Trigger
   The user changes the enabled toggle, source-link color, or underline checkbox in the popup.

2. Main functions involved
   Popup: `queueSaveSettings`, `readSettingsFromControls`, `saveSettings`, `refreshActiveContentScript`, `renderPreview`. Content: `handleStorageChange` or the `YACHT_REFRESH_FROM_STORAGE` message handler.

3. State fields touched
   Popup `currentSettings` and `saveTimer`. Content `state.settings`, plus `state.pendingAsk` and `state.lastSelection` when disabled.

4. Persistent data touched
   The popup sends `YACHT_SAVE_SETTINGS` to the background, which writes `yacht.settings` in `chrome.storage.local`. If the background is not responding, the popup writes fallback settings under `yachtSettings`.

5. DOM changes made
   The popup updates the preview and status text. The content script updates CSS variables, source-link underline data, header control state, source links, and message visibility on render.

6. Failure or fallback behavior
   Saves are debounced. If the background settings API does not respond, the popup uses local fallback storage and shows a warning. If the active tab has no content script, refresh messaging is ignored.

## 16. Import/Export/Reset

1. Trigger
   The user clicks Export, Import, or Reset in the popup.

2. Main functions involved
   Popup: `exportData`, `importData`, `resetAllData`, `downloadJson`, `importDataToLocalStorage`, `loadSettings`, `refreshActiveContentScript`. Background: `exportData`, `importData`, `resetAllData`, `openDatabase`, `getAllFromStore`, `saveSettings`.

3. State fields touched
   Popup busy and status UI state. Content state is refreshed only after the popup sends `YACHT_REFRESH_FROM_STORAGE` or storage changes fire.

4. Persistent data touched
   Export reads settings, anchors, and threads. Import writes anchors and threads to IndexedDB and may write settings. Replace mode clears anchor and thread stores first. Reset clears anchor and thread stores and restores default settings in `chrome.storage.local`.

5. DOM changes made
   The popup disables controls while busy, updates status text, opens the reset confirmation dialog, and downloads JSON for export. Content DOM updates happen after refresh/render.

6. Failure or fallback behavior
   Import rejects missing files, invalid JSON, or unsupported `schemaVersion`. If the background is unavailable, export falls back to all `chrome.storage.local` data, import writes to local storage, and reset clears local storage.

## 17. Fail-safe Activation

1. Trigger
   Each `render` calls `probeDom`.

2. Main functions involved
   `probeDom`, `setDiagnostic`, `readTurnInfos`, `render`, `restoreOriginalRendering`

3. State fields touched
   `state.failSafe`, `state.diagnostic`, `state.settings.enabled`

4. Persistent data touched
   None.

5. DOM changes made
   `setDiagnostic` adds or removes `.yacht-diagnostic`. When fail-safe is active, `render` calls `restoreOriginalRendering`, which removes source links, hidden-turn classes, legacy composer overlays, and the thread chooser.

6. Failure or fallback behavior
   Fail-safe turns on only when the extension is enabled, the page is a ChatGPT conversation URL, ChatGPT message elements exist, but `readTurnInfos` finds no recognized turns. When the DOM is recognized again, `probeDom` clears fail-safe and removes the diagnostic.
