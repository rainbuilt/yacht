# Content Script Modules

This guide explains what each file under `src/content/` does and where a beginner maintainer should make common changes.

The content script runs inside the ChatGPT page. It reads the page DOM, remembers selected assistant text as anchors, creates Ask ChatGPT subthreads, hides or shows turns depending on the current mode, and renders YACHT UI such as source links and header controls.

## Startup Flow

1. `src/content/content.js` is the small entry point listed by the extension manifest.
2. It builds a URL with `chrome.runtime.getURL("src/content/app.js")`.
3. It dynamically imports `app.js`.
4. It reads the exported `initialize()` function from that module.
5. It calls `await initialize()`.

`initialize()` is where the real startup happens. It prevents double startup with `state.initialized`, loads settings, conversation data, and navigation state, registers document events, subscribes to storage changes, starts DOM observation and route polling, checks replied-content state, and runs the first `render()`.

If the dynamic import or initialization call fails before `app.js` can handle it, `content.js` logs `[Yacht] content script failed to load`.

## Where Do I Change X?

| Problem or change | Start here | Also check |
| --- | --- | --- |
| ChatGPT selectors changed | `src/content/constants.js` | `src/content/dom-readers.js`, `src/content/diagnostics.js`, `src/content/app.js` functions that use `SELECTORS` |
| Source link style changed | `src/content/content.css` | `src/content/app.js` `applyStyleSettings()` and `createSourceLink()`, `src/content/constants.js` `DEFAULT_SETTINGS.sourceLinkStyle` |
| Selection capture broken | `src/content/selection.js` | `src/content/events.js`, `src/content/utils.js` `textNodesUnder()`, `src/content/dom-readers.js` message keys |
| Thread visibility broken | `src/content/app.js` `applyMessageVisibility()` | `src/content/thread-model.js`, `src/content/dom-readers.js` |
| Settings not loading | `src/content/persistence.js` | `src/content/app.js` `initialize()` and `handleStorageChange()`, `src/content/constants.js` `SETTINGS_KEY` and `DEFAULT_SETTINGS` |
| Fail-safe diagnostic appears | `src/content/diagnostics.js` | `src/content/constants.js` `SELECTORS`, `src/content/dom-readers.js` `readTurnInfos()` |
| Header controls misplaced | `src/content/app.js` `mountHeaderControls()`, `placeHeaderControls()`, `findHeaderMountPoint()` | `src/content/constants.js` header selectors, `src/content/content.css` header styles |
| Event handling broken | `src/content/events.js` | `src/content/app.js` `handleDocumentPointerDown()`, `handleDocumentClick()`, `handleDocumentInput()`, `handleDocumentKeyDown()` |

## `src/content/content.js`

### Purpose

This is the lightweight loader for the content script. It keeps the manifest-facing script simple and loads the module-based implementation from `app.js`.

### Important exports or functions

This file has no exports.

It contains one immediately invoked async function that:

- calls `chrome.runtime.getURL("src/content/app.js")`
- dynamically imports that URL
- calls the imported `initialize()`
- logs a content-script load error if startup fails

### When to edit this file

Edit this only if the content script entry strategy changes, for example if the app module path changes or the extension needs different bootstrapping before `initialize()`.

### What not to change casually

Do not move feature logic into this file. Do not replace the dynamic import unless you also confirm Chrome extension module loading still works for the manifest setup.

## `src/content/app.js`

### Purpose

This is the main coordinator for the content script. It wires all helper modules together and still owns much of the page behavior:

- startup through `initialize()`
- settings application
- header control rendering and placement
- source link rendering
- source link click handling
- Ask ChatGPT pending-thread reconciliation
- subthread navigation
- message visibility
- scrolling after navigation
- document event handlers
- mutation handling
- route change polling
- runtime message handling

### Important exports or functions

Exported:

- `initialize()`

Important internal functions still inside this file include:

- Startup and lifecycle: `render()`, `scheduleRender()`, `scheduleRenderPasses()`, `processMutation()`, `handleMutation()`, `observeRouteChanges()`, `handleStorageChange()`
- Header controls: `mountHeaderControls()`, `placeHeaderControls()`, `updateHeaderControls()`, `findHeaderMountPoint()`, `activateHeaderControl()`
- Source links: `applySourceLinks()`, `clearSourceLinks()`, `restoreAnchorRange()`, `findRangeByTextContext()`, `rangeFromTextOffsets()`, `wrapTextOffsets()`, `wrapRangeAsSingleSourceLink()`, `wrapTextOffsetsByTextNode()`, `createSourceLink()`, `findAnchorAtPoint()`, `findAnchorsAtPoint()`, `openAnchors()`
- Thread visibility and navigation: `applyMessageVisibility()`, `clearMessageVisibility()`, `navigateToThread()`, `returnToSource()`, `queueScrollToThread()`, `queueScrollToAnchor()`
- Pending Ask flow: `createPendingAsk()`, `reconcilePendingAsk()`, `schedulePendingReconcile()`, `persistAnchor()`, `persistThread()`
- Auto context and composer behavior: `shouldAttachAutoContext()`, `ensureAutoContextForCurrentThread()`, `handleSendWithAutoContext()`, `selectRangeForNativeAsk()`, `dispatchSelectionReleaseEvent()`, `findNativeAskButton()`, `hasActiveRepliedContent()`, `composerContainers()`, `findComposerDescendant()`, `focusComposer()`
- Event handlers passed to `events.js`: `handleDocumentPointerDown()`, `handleDocumentPointerMove()`, `handleDocumentPointerUp()`, `handleDocumentPointerCancel()`, `handleDocumentClick()`, `handleDocumentInput()`, `handleDocumentKeyDown()`
- Diagnostics and cleanup helpers: `restoreOriginalRendering()`, `removeLegacyComposerOverlay()`, `refreshRepliedContentState()`

### When to edit this file

Edit this when changing behavior that depends on several modules at once. Common examples are changing how a subthread is created, changing what happens when a source link is clicked, changing which messages are hidden in main or subthread mode, changing header button behavior, or changing render timing.

This is also where to look when a bug is not just about reading the DOM or storing data, but about how YACHT reacts to page changes.

### What not to change casually

Do not casually change the order inside `render()`. It intentionally probes the DOM, applies styles, mounts header controls, restores the page when disabled or in fail-safe mode, then applies source links and message visibility.

Do not change the pending Ask flow without checking `selection.js`, `dom-readers.js`, `thread-model.js`, and `persistence.js`. The flow depends on captured selection data, user reference detection, thread key derivation, and background storage messages.

Do not remove the observer disconnect and reconnect around rendering unless you understand the mutation loop it prevents.

## `src/content/constants.js`

### Purpose

This file holds shared constants used by the content modules. It centralizes storage keys, schema version, timing values, ChatGPT selectors, ignore selectors, source-link safety selectors, and default settings.

### Important exports or functions

Exports:

- `SETTINGS_KEY`
- `NAV_KEY_PREFIX`
- `SCHEMA_VERSION`
- `HEADER_MOUNT_DELAY_MS`
- `POST_RENDER_SCROLL_DELAYS_MS`
- `SUBTHREAD_CONTINUATION_ARM_MS`
- `AUTO_CONTEXT_SUPPRESS_MS`
- `AUTO_CONTEXT_WAIT_MS`
- `PENDING_ASK_TIMEOUT_MS`
- `UNMATCHED_USER_TURN_GRACE_MS`
- `SELECTORS`
- `TEXT_NODE_IGNORE_SELECTOR`
- `TEXT_BLOCK_SELECTOR`
- `AUTO_CONTEXT_IGNORE_SELECTOR`
- `UNSAFE_SOURCE_LINK_SELECTOR`
- `BLOCK_SOURCE_LINK_SELECTOR`
- `DEFAULT_SETTINGS`

### When to edit this file

Edit this when ChatGPT changes DOM attributes or layout and selectors stop matching. Also edit it when changing storage key names, default settings, schema version, or timing constants that are meant to be shared across modules.

### What not to change casually

Do not rename storage keys or change `SCHEMA_VERSION` casually because persisted data and background messages depend on them.

Do not loosen `UNSAFE_SOURCE_LINK_SELECTOR` or `BLOCK_SOURCE_LINK_SELECTOR` without testing source-link wrapping. These selectors help avoid wrapping interactive controls or large block structures in links.

## `src/content/state.js`

### Purpose

This file owns the shared in-memory state object for the content script. Other modules import and mutate `state` during the page session.

### Important exports or functions

Exports:

- `state`
- `resetThreadNavigationState()`

Important state fields include:

- `conversationId`
- `settings`
- `data.anchors`
- `data.threads`
- `mode`
- `currentThreadId`
- `pendingAsk`
- `lastSelection`
- observer and timer fields
- render signatures
- subthread continuation fields
- fail-safe and diagnostic fields
- suppression timestamps for event handling

### When to edit this file

Edit this when adding or removing shared runtime state that several content modules need. For example, a new timer, a new render cache signature, or a new cross-handler flag belongs here.

### What not to change casually

Do not replace `state` with separate local module state unless you update all modules that rely on shared mutation. Do not change the meaning of `mode`, `currentThreadId`, `pendingAsk`, or `lastSelection` without following the whole Ask and navigation flow.

## `src/content/utils.js`

### Purpose

This file contains small generic helpers that do not belong to one feature area. Most helpers are about URL parsing, settings merging, text normalization, stable hashes, IDs, DOM node conversion, and extracting text nodes.

### Important exports or functions

Exports:

- `isChatGptConversationUrl()`
- `getConversationId()`
- `mergeSettings()`
- `normalizeText()`
- `normalizeWithRawMap()`
- `shortTitle()`
- `hashString()`
- `createId()`
- `nodeElement()`
- `textNodesUnder()`
- `textFromNodes()`

### When to edit this file

Edit this when changing general text normalization, conversation ID parsing, settings merge behavior, ID creation, or the rules for which text nodes count as message text.

### What not to change casually

Do not change `normalizeText()` or `textNodesUnder()` casually. Selection offsets, source range restoration, message fallback keys, and Ask reference matching all depend on consistent text handling.

Do not change `getConversationId()` without checking navigation storage in `persistence.js`.

## `src/content/dom-readers.js`

### Purpose

This file reads ChatGPT messages from the DOM and converts them into plain turn information that other modules can use. It is the bridge between ChatGPT's page structure and YACHT's thread model.

### Important exports or functions

Exports:

- `readTurnInfos()`
- `getMessageKey()`
- `findMessageByKey()`
- `findTurnInfoForMessageKey()`
- `getUserQuestionText()`
- `getUserReferenceTexts()`
- `normalizeAskReferenceText()`
- `isAskUserTurnForAnchor()`

### When to edit this file

Edit this when ChatGPT changes message markup, role attributes, message IDs, replied-content controls, or Ask ChatGPT reference text. This is also where to improve how YACHT decides that a new user turn belongs to a selected source anchor.

### What not to change casually

Do not change message key format casually. Thread visibility and stored thread records rely on keys from `getMessageKey()`.

Do not make `readTurnInfos()` return non-message elements. Many modules assume each item has `turn`, `message`, `role`, `index`, and `key`.

## `src/content/thread-model.js`

### Purpose

This file contains the thread and anchor lookup logic. It decides which messages belong to each subthread and which messages belong to the main thread.

### Important exports or functions

Exports:

- `findAnchor()`
- `findThread()`
- `threadsForAnchor()`
- `anchorsWithThreads()`
- `effectiveMessageKeysForThread()`
- `buildThreadKeyMap()`
- `deriveThreadMessageKeys()`
- `orderMessageKeys()`
- `setSubthreadBaselineFromCurrentTurns()`
- `armSubthreadContinuation()`
- `getCurrentThreadContext()`
- `getCurrentSubthreadKeys()`
- `getCurrentMainThreadKeys()`
- `isMessageKeyInCurrentThread()`
- `allOtherThreadMessageKeys()`
- `findDirectParentThread()`

### When to edit this file

Edit this when changing the rules for which messages are part of a subthread, which messages are hidden from the main thread, how continuation messages are appended, or how nested subthreads find their parent.

### What not to change casually

Do not change `deriveThreadMessageKeys()` or `buildThreadKeyMap()` without testing both main mode and subthread mode. Those functions directly affect message visibility and stored thread repair.

Do not change `armSubthreadContinuation()` timing behavior without checking composer input and send handling in `app.js`.

## `src/content/persistence.js`

### Purpose

This file handles storage and background-script communication for the content script. It loads settings and conversation data, persists navigation state locally, and wraps runtime messages.

### Important exports or functions

Exports:

- `currentNavKey()`
- `sendRuntime()`
- `loadSettings()`
- `loadConversationData()`
- `loadNavigationState()`
- `scheduleSaveNavigationState()`

### When to edit this file

Edit this when changing content-script communication with the background script, settings loading, conversation data loading, or per-conversation navigation persistence.

### What not to change casually

Do not change runtime message type strings such as `YACHT_GET_SETTINGS`, `YACHT_GET_CONVERSATION_DATA`, or storage behavior unless the background script is updated too.

Do not remove validation in `loadNavigationState()`. It avoids restoring a subthread ID that no longer exists in loaded data.

## `src/content/selection.js`

### Purpose

This file captures the user's selected assistant text and turns that selection into an anchor record. It stores enough text context to find the same text later even if exact offsets shift.

### Important exports or functions

Exports:

- `captureSelection()`
- `offsetsForRange()`
- `findExistingAnchor()`
- `buildAnchorFromSelection()`

### When to edit this file

Edit this when selection capture is wrong, when anchors need more stored context, or when duplicate-anchor detection needs to change.

### What not to change casually

Do not allow selections outside a single assistant message unless all source-link restoration and Ask-thread creation code is updated too.

Do not change offset calculation without checking `app.js` range restoration and source-link wrapping. They expect offsets based on `textNodesUnder()`.

## `src/content/diagnostics.js`

### Purpose

This file shows or clears the fail-safe diagnostic and detects when the expected ChatGPT message DOM is not recognized.

### Important exports or functions

Exports:

- `setDiagnostic()`
- `probeDom()`

### When to edit this file

Edit this when changing the fail-safe message, the conditions that trigger fail-safe mode, or the diagnostic UI element behavior.

### What not to change casually

Do not remove fail-safe behavior. It prevents YACHT from hiding or rewriting page content when ChatGPT's DOM no longer matches expected selectors.

Do not change `probeDom()` without checking `SELECTORS.message`, `readTurnInfos()`, and `render()`.

## `src/content/observers.js`

### Purpose

This file manages the `MutationObserver` that watches ChatGPT for page changes. It chooses observation roots and reconnects the observer after each render.

### Important exports or functions

Exports:

- `observationRoots()`
- `observeDom()`

### When to edit this file

Edit this when ChatGPT changes the main page, header, or composer container structure enough that mutations are missed. Also edit it when render performance requires narrower or broader observer roots.

### What not to change casually

Do not observe the whole document subtree by default unless necessary. It can cause extra mutation work.

Do not create multiple observers. The code intentionally stores one observer in `state.mutationObserver` and reconnects it.

## `src/content/events.js`

### Purpose

This file registers document-level event listeners. It does not decide what each event means; it delegates to handlers passed from `app.js`.

### Important exports or functions

Exports:

- `registerDocumentEvents()`

It registers:

- `selectionchange`, delayed by 60 ms before calling `captureSelection`
- `input`
- `keydown`
- `pointerdown`
- `pointermove`
- `pointerup`
- `pointercancel`
- `click`

### When to edit this file

Edit this when adding, removing, or changing global event listener registration. For behavior changes inside an event, usually edit the handler in `app.js` instead.

### What not to change casually

Do not remove capture-phase listeners without checking source-link clicks, header controls, composer typing, and send handling. These handlers need to run before some ChatGPT page handlers.

Do not remove the delayed `selectionchange` capture without checking browser selection timing.

## `src/content/content.css`

### Purpose

This stylesheet defines all content-script UI styles injected by the extension. It styles the YACHT header controls, hidden turns, source links, thread chooser popover, and diagnostic banner.

### Important exports or functions

CSS has no JavaScript exports.

Important selectors include:

- `:root` with `--yacht-link-color`
- `.yacht-header-controls`
- `.yacht-header-button`
- `.yacht-toggle`
- `.yacht-hidden-turn`
- `.yacht-source-link`
- `.yacht-popover`
- `.yacht-diagnostic`

### When to edit this file

Edit this when changing visual presentation: source link color or underline behavior, header button sizing, popover appearance, hidden-turn behavior, dark mode colors, or diagnostic banner styling.

### What not to change casually

Do not remove `.yacht-hidden-turn { display: none !important; }` unless message visibility is redesigned.

Do not rename CSS classes without updating `app.js`, `constants.js`, and any DOM cleanup code that queries those classes.

Do not remove `--yacht-link-color` unless `applyStyleSettings()` is updated too.
