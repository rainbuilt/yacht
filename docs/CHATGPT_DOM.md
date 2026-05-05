# ChatGPT DOM Dependencies

## 1. Why This Document Exists

YACHT runs inside the ChatGPT page. It does not control ChatGPT's HTML, so it must find ChatGPT messages, buttons, composer controls, and header areas by reading the live DOM.

This document explains those DOM dependencies for a beginner maintainer. Use it when ChatGPT changes its HTML and YACHT stops reading turns, capturing selections, restoring source links, mounting header controls, or detecting native "Ask ChatGPT" replied content.

Do not assume the ChatGPT DOM is stable. Treat every selector here as a dependency that may need to be checked again in browser DevTools.

The selector definitions live in `src/content/constants.js`. The main reader logic lives in `src/content/dom-readers.js`, `src/content/selection.js`, `src/content/app.js`, `src/content/diagnostics.js`, and `src/content/utils.js`.

If the files exist, `References/ChatGPT_Reference.html` and `References/ChatGPT_Reference_Packed.html` can be used as old reference material only. They are snapshots, not proof that the current ChatGPT DOM still matches.

## 2. Main DOM Selectors

These selector names come from `SELECTORS` in `src/content/constants.js`.

| Selector name | Current selector | What YACHT uses it for |
| --- | --- | --- |
| `header` | `header#page-header` | Finds the ChatGPT page header before mounting YACHT controls. |
| `headerActions` | `#conversation-header-actions` | Preferred parent for YACHT header controls. |
| `headerActionsFallback` | `[data-testid="thread-header-right-actions"]` | Fallback parent for YACHT header controls. |
| `shareButton` | `[data-testid="share-chat-button"]` | Preferred insert-before target for YACHT controls. |
| `optionsButton` | `[data-testid="conversation-options-button"][aria-label="Open conversation options"]` | Fallback insert-before target for YACHT controls. |
| `turn` | `section[data-testid^="conversation-turn-"][data-turn]` | Finds each conversation turn. This is the most important selector for reading threads. |
| `message` | `[data-message-author-role]` | Finds any user or assistant message element. |
| `assistantMessage` | `[data-message-author-role="assistant"]` | Identifies assistant messages. Selection capture also uses this role directly. |
| `userReferenceButton` | `[data-message-author-role="user"] button:has(p.line-clamp-3)` | Detects a user turn that contains ChatGPT's replied-content reference. |
| `repliedContent` | `button[aria-label="More about replied content"]` | Detects active replied content in the composer. |
| `removeRepliedContent` | `button[aria-label="Remove"]` | Clears pending Ask tracking when the user removes replied content. |
| `composerContainer` | `#thread-bottom-container, #thread-bottom` | Finds composer interactions, focus target, and composer-scoped replied content. |
| `sendButton` | `button[data-testid="send-button"], button[aria-label="Send prompt"]` | Detects send clicks and Enter-to-send auto-context behavior. |

Text-related selectors and constants from `src/content/constants.js`:

| Constant | Current selector | What YACHT uses it for |
| --- | --- | --- |
| `TEXT_NODE_IGNORE_SELECTOR` | `script, style, textarea, button, .yacht-header-controls, .yacht-popover, .yacht-diagnostic` | Excludes UI and non-message text from `textNodesUnder()` and `textFromNodes()`. |
| `TEXT_BLOCK_SELECTOR` | `p, li, blockquote, pre, code, h1, h2, h3, h4, h5, h6, td, th` | Finds text blocks when selecting the last assistant answer for auto-context. |
| `AUTO_CONTEXT_IGNORE_SELECTOR` | `button, [role='button'], [aria-label='Sources'], [aria-label='More about replied content'], [data-testid='copy-turn-action-button'], [data-testid='conversation-turn-actions'], .yacht-header-controls, .yacht-popover, .yacht-diagnostic` | Prevents auto-context from selecting buttons, sources UI, ChatGPT turn actions, and YACHT UI. |
| `UNSAFE_SOURCE_LINK_SELECTOR` | `a, button, input, textarea, select, summary, [contenteditable='true'], .yacht-header-controls, .yacht-popover, .yacht-diagnostic` | Prevents wrapping interactive or YACHT-owned elements inside a source link. |
| `BLOCK_SOURCE_LINK_SELECTOR` | `address, article, aside, blockquote, caption, col, colgroup, details, dialog, div, dl, fieldset, figcaption, figure, footer, form, h1, h2, h3, h4, h5, h6, header, hr, li, main, nav, ol, p, pre, section, table, tbody, td, tfoot, th, thead, tr, ul` | Prevents a single source link wrapper from crossing block elements. YACHT falls back to segmented wrappers. |

## 3. How Turn Reading Works

`readTurnInfos()` in `src/content/dom-readers.js` is the central DOM reader.

It works in this order:

1. It calls `document.querySelectorAll(SELECTORS.turn)`.
2. For each turn, it looks for a message with `[data-message-author-role][data-message-id]`.
3. If that exact message is not found, it falls back to `turn.querySelector(SELECTORS.message)`.
4. It reads the role from `data-message-author-role`.
5. If the message role is missing, it falls back to the turn's `data-turn`.
6. If no message element exists, that turn is ignored.
7. It returns objects shaped like `{ turn, message, role, index, key }`.

The `turn` selector must find the outer conversation turn. The `message` selector must find the actual message body or message wrapper. If either selector stops matching, YACHT cannot reliably build thread state.

## 4. How Selection Capture Works

`captureSelection()` in `src/content/selection.js` runs when document selection changes.

It only records a selection when all of these checks pass:

1. Selection capture is not temporarily suppressed.
2. The browser selection exists, has a range, and is not collapsed.
3. The selection starts inside `[data-message-author-role="assistant"]`.
4. The selection ends inside the same assistant message.
5. The normalized selected text has at least 2 characters.
6. `offsetsForRange()` can convert the DOM range to text offsets inside that assistant message.

The stored selection includes:

- `selectedText`
- `sourceMessageId`, from `data-message-id` when available
- `sourceMessageKey`, from `readTurnInfos()` or `getMessageKey()`
- `startOffset` and `endOffset`
- nearby `prefixText` and `suffixText`
- `sourceHash`, based on the full assistant text

Text offsets are based on `textFromNodes()`, which uses `TEXT_NODE_IGNORE_SELECTOR`. If ChatGPT starts putting important assistant text inside a selector that YACHT ignores, selection offsets and source restoration can become wrong.

## 5. How Source Links Are Restored

Source links are restored in `src/content/app.js`.

The key functions are:

- `findSourceMessage(anchor, turns)`: first tries `anchor.sourceMessageId` against `[data-message-id="..."]`, then falls back to a matching `sourceMessageKey` from `readTurnInfos()`.
- `restoreAnchorRange(anchor, turns)`: finds the source message and tries to restore the selected text range.
- `rangeFromTextOffsets(root, startOffset, endOffset)`: converts saved text offsets back into a live DOM `Range`.
- `wrapTextOffsets(...)`: wraps the restored range with `.yacht-source-link`.

Restoration first tries the exact saved offsets. It checks that the text at those offsets still normalizes to the saved `selectedText`.

If exact offsets fail, `findRangeByTextContext()` searches the current message text for the saved selected text and scores matches using:

- whether the selected text appears only once
- distance from the old start offset
- matching saved prefix text
- matching saved suffix text

YACHT only restores the link when confidence is high enough. This is intentional. A missing source link is better than wrapping the wrong text.

`UNSAFE_SOURCE_LINK_SELECTOR` and `BLOCK_SOURCE_LINK_SELECTOR` control whether YACHT can wrap the selection with one link. If the range includes unsafe interactive content or crosses block elements, YACHT falls back to segmented text-node wrapping.

## 6. Header Control Mounting

Header controls are mounted by `mountHeaderControls()` and `findHeaderMountPoint()` in `src/content/app.js`.

The process is:

1. Find `SELECTORS.header`, or use `document` as a fallback.
2. Inside that header, find `SELECTORS.headerActions`.
3. If that fails, find `SELECTORS.headerActionsFallback`.
4. Prefer inserting before `SELECTORS.shareButton`.
5. If the share button is not visible, insert before `SELECTORS.optionsButton`.
6. If neither button is visible, insert before the first child in the actions parent.

If header controls disappear but messages still work, inspect `header`, `headerActions`, `headerActionsFallback`, `shareButton`, and `optionsButton` first.

## 7. Native Ask ChatGPT Detection

YACHT does not use a fixed selector for the native Ask ChatGPT floating button. It scans visible buttons with `findNativeAskButton()` in `src/content/app.js`.

`findNativeAskButton()`:

1. Reads all `button` elements.
2. Ignores buttons inside `.yacht-header-controls` and `.yacht-popover`.
3. Keeps only visible buttons.
4. Uses `isAskButtonLike()`.

`isAskButtonLike()` checks the button's `aria-label`, `title`, and `textContent`, normalizes the text, lowercases it, and accepts labels that include `ask chatgpt` or exactly equal `ask`.

If ChatGPT renames this control, changes it from a button to another element, hides the label, or localizes the text, native Ask detection may stop working.

## 8. Replied Content Detection

YACHT uses replied content to connect a selected assistant passage to a new user Ask turn.

`hasActiveRepliedContent()` in `src/content/app.js` returns true if either check matches:

1. `SELECTORS.repliedContent`, currently `button[aria-label="More about replied content"]`
2. A composer-scoped fallback: `${SELECTORS.composerContainer} :is(button, [role="button"]):has(p.line-clamp-3)`

After a user sends an Ask prompt, `reconcilePendingAsk()` looks for new user turns and calls `isAskUserTurnForAnchor()`.

`isAskUserTurnForAnchor()` uses `getUserReferenceTexts()`, which finds buttons containing `p.line-clamp-3` inside user messages. It compares that replied-content text with the saved selected text after normalization.

The related selector in `SELECTORS` is `userReferenceButton`, currently `[data-message-author-role="user"] button:has(p.line-clamp-3)`. It is also used for returning from a subthread when the user clicks the reference button.

## 9. Fail-safe Behavior

Fail-safe mode is controlled by `probeDom()` in `src/content/diagnostics.js`.

The check is specific:

1. YACHT is enabled.
2. The page URL looks like a ChatGPT conversation URL: `/c/...`.
3. `document.querySelector(SELECTORS.message)` finds at least one message.
4. `readTurnInfos()` returns zero turns.

When all four are true, YACHT sets `state.failSafe = true` and displays:

`YACHT is in fail-safe mode because the ChatGPT message DOM was not recognized.`

This usually means ChatGPT still has message elements, but `SELECTORS.turn` no longer finds the expected turn wrapper. In fail-safe mode, YACHT clears its own source links and hidden-turn classes and avoids modifying the conversation rendering.

ChatGPT DOM changes can trigger fail-safe mode because YACHT depends on the relationship between turn wrappers and message nodes. For example, if ChatGPT removes `section[data-testid^="conversation-turn-"][data-turn]` but keeps `[data-message-author-role]`, the extension can see messages but cannot safely group them into ordered turns.

## 10. DOM Breakage Symptoms

| Symptom | Likely broken selector | File to inspect | First check to perform |
| --- | --- | --- | --- |
| Fail-safe diagnostic appears on a conversation page. | `turn` | `src/content/constants.js`, `src/content/diagnostics.js`, `src/content/dom-readers.js` | In DevTools Console, run `document.querySelectorAll('section[data-testid^="conversation-turn-"][data-turn]').length` and compare it to visible turns. |
| No turns are hidden when entering a subthread. | `turn` or `message` | `src/content/constants.js`, `src/content/app.js`, `src/content/dom-readers.js` | Check that each visible ChatGPT turn has a matched turn wrapper and a child with `data-message-author-role`. |
| Source links are not restored on selected assistant text. | `message`, `assistantMessage`, `TEXT_NODE_IGNORE_SELECTOR`, `UNSAFE_SOURCE_LINK_SELECTOR`, `BLOCK_SOURCE_LINK_SELECTOR` | `src/content/constants.js`, `src/content/app.js`, `src/content/utils.js` | Inspect the assistant message and verify its text is included by `textFromNodes()` and not inside ignored UI. |
| Selecting assistant text does nothing. | `assistantMessage` | `src/content/selection.js`, `src/content/constants.js` | Select text, then check whether the selection start and end are inside an element matching `[data-message-author-role="assistant"]`. |
| Native Ask ChatGPT click does not create a subthread. | Native Ask button label or replied-content selectors | `src/content/app.js`, `src/content/dom-readers.js` | Inspect the native Ask control and verify it is a visible `button` whose label, title, or text includes `Ask ChatGPT` or equals `Ask`. |
| Ask replied content appears in the composer but YACHT does not track it. | `repliedContent` or `composerContainer` fallback | `src/content/constants.js`, `src/content/app.js` | Check whether `button[aria-label="More about replied content"]` or the composer-scoped `:has(p.line-clamp-3)` fallback matches. |
| Clicking a user replied-content reference no longer returns to the source. | `userReferenceButton` | `src/content/constants.js`, `src/content/app.js` | Inspect the user turn and confirm the reference is still a button containing `p.line-clamp-3`. |
| YACHT header toggle or back button is missing. | `header`, `headerActions`, `headerActionsFallback`, `shareButton`, `optionsButton` | `src/content/constants.js`, `src/content/app.js` | Check which header action container exists and whether the share/options buttons are still visible. |
| Auto-context send does not work. | `composerContainer`, `sendButton`, `TEXT_BLOCK_SELECTOR`, `AUTO_CONTEXT_IGNORE_SELECTOR` | `src/content/constants.js`, `src/content/app.js` | Verify the composer container and send button match, then inspect the last assistant answer text blocks. |
| Pending Ask state clears after sending a normal prompt. | `userReferenceButton` or replied-content text shape | `src/content/dom-readers.js`, `src/content/app.js` | Check whether the new user turn contains reference text that matches the original selected text. |

## 11. Step-by-Step Selector Update Process

Use this process when ChatGPT changes its DOM.

1. Reproduce the symptom on a real ChatGPT conversation page.
2. Open browser DevTools with `F12` or `Cmd+Option+I` / `Ctrl+Shift+I`.
3. Go to the Elements tab.
4. Inspect one visible user turn and one visible assistant turn.
5. Find the outer element that represents one whole turn.
6. In the Console, test the current turn selector:

   ```js
   document.querySelectorAll('section[data-testid^="conversation-turn-"][data-turn]').length
   ```

7. If the count is zero or much lower than visible turns, inspect the new turn wrapper attributes and update only `SELECTORS.turn`.
8. Test the message selector:

   ```js
   document.querySelectorAll('[data-message-author-role]').length
   ```

9. Inspect whether user and assistant roles are still stored in `data-message-author-role`. If not, update the reader code and tests carefully; do not only change the selector name.
10. Inspect whether messages still have `data-message-id`. If not, fallback keys will be used more often.
11. Test header selectors from the Console when header controls are broken:

   ```js
   document.querySelector('header#page-header')
   document.querySelector('#conversation-header-actions')
   document.querySelector('[data-testid="thread-header-right-actions"]')
   ```

12. Test composer selectors when Ask or send behavior is broken:

   ```js
   document.querySelector('#thread-bottom-container, #thread-bottom')
   document.querySelector('button[data-testid="send-button"], button[aria-label="Send prompt"]')
   document.querySelector('button[aria-label="More about replied content"]')
   ```

13. Test user replied-content references inside a sent user turn:

   ```js
   document.querySelectorAll('[data-message-author-role="user"] button:has(p.line-clamp-3)').length
   ```

14. If source links restore incorrectly, inspect the assistant message text structure. Confirm that message text is not inside a button, textarea, YACHT UI, or another selector listed in `TEXT_NODE_IGNORE_SELECTOR`.
15. Make the smallest selector change that matches the current DOM and keeps the original meaning.
16. Do not broaden selectors until they match unrelated UI. A broad selector can hide the wrong turns or wrap the wrong text.
17. Reload the extension and the ChatGPT tab.
18. Test normal conversation view, creating an Ask subthread, returning to source, source link rendering, and sending inside a subthread.

## 12. Manual DOM Debug Checklist

Run these checks in browser DevTools on a live ChatGPT conversation.

1. Conversation URL check:

   ```js
   location.pathname
   ```

   It should look like `/c/...` for `probeDom()` to treat it as a conversation.

2. Message count check:

   ```js
   document.querySelectorAll('[data-message-author-role]').length
   ```

   This should be greater than zero on a conversation with visible messages.

3. Turn count check:

   ```js
   document.querySelectorAll('section[data-testid^="conversation-turn-"][data-turn]').length
   ```

   This should roughly match the number of visible user and assistant turns.

4. Role check:

   ```js
   [...document.querySelectorAll('[data-message-author-role]')].map((node) => node.getAttribute('data-message-author-role')).slice(0, 10)
   ```

   Expect values like `user` and `assistant`.

5. Message ID check:

   ```js
   [...document.querySelectorAll('[data-message-author-role]')].map((node) => node.getAttribute('data-message-id')).slice(0, 10)
   ```

   Stable `data-message-id` values give YACHT stronger message keys.

6. Assistant selection boundary check:

   ```js
   const selection = getSelection();
   selection.rangeCount && selection.getRangeAt(0).startContainer.parentElement?.closest('[data-message-author-role="assistant"]');
   ```

   After selecting assistant text, this should return an assistant message element.

7. Replied content check:

   ```js
   document.querySelector('button[aria-label="More about replied content"]')
   ```

   If this is `null` while replied content is visibly active, inspect the composer markup.

8. Composer fallback replied-content check:

   ```js
   document.querySelector('#thread-bottom-container, #thread-bottom')?.querySelector(':is(button, [role="button"]):has(p.line-clamp-3)')
   ```

   This should find replied content when ChatGPT renders the reference inside the composer.

9. Header mount check:

   ```js
   document.querySelector('#conversation-header-actions') || document.querySelector('[data-testid="thread-header-right-actions"]')
   ```

   This should return the parent where YACHT can insert controls.

10. Native Ask button check:

    ```js
    [...document.querySelectorAll('button')].filter((button) => /ask chatgpt|^ask$/i.test(`${button.ariaLabel ?? ''} ${button.title ?? ''} ${button.textContent ?? ''}`.replace(/\s+/g, ' ').trim()))
    ```

    This should include ChatGPT's native Ask control after selecting assistant text.

11. Source-link safety check:

    Inspect the selected assistant text. If the selection crosses links, buttons, form fields, or large block wrappers, YACHT may use segmented links or skip low-confidence restoration.

12. Fail-safe check:

    If `[data-message-author-role]` matches but the turn selector returns zero, YACHT is expected to enter fail-safe mode. Update the turn selector before changing source-link or subthread logic.

## Message Keys and Fallback Keys

`getMessageKey(message, role, index)` in `src/content/dom-readers.js` creates the stable key YACHT stores for each turn.

It prefers ChatGPT's `data-message-id`:

```text
message:<data-message-id>
```

If `data-message-id` is missing, it creates a fallback key:

```text
fallback:<role>:<index>:<hash>
```

The hash is made from the first 160 characters of normalized message text.

Fallback keys let YACHT keep working when `data-message-id` is missing, but they are weaker than real message IDs. They can change when ChatGPT inserts, removes, reorders, or edits messages because the fallback includes the turn index and text hash.

`findMessageByKey(messageKey, turns)` reverses this lookup:

- For `message:...` keys, it queries `[data-message-id="..."]`.
- For fallback keys, it searches the current `readTurnInfos()` result for an exact key match.

`findTurnInfoForMessageKey(messageKey, turns)` first looks for an exact `turnInfo.key`. If that fails, it calls `findMessageByKey()`, finds the closest `SELECTORS.turn`, and returns the matching turn info for that turn.

These functions are why the `turn`, `message`, and `data-message-id` dependencies matter. If ChatGPT changes them, YACHT can lose the ability to map saved anchors and threads back to live messages.
