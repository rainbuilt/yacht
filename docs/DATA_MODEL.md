# YACHT Data Model

## 1. Overview

YACHT stores two kinds of data:

- Persistent data, which survives page reloads and browser restarts.
- Runtime-only data, which lives in the content script while the ChatGPT page is open.

Persistent data is split between `chrome.storage.local` and IndexedDB. Settings and per-conversation navigation state are stored in `chrome.storage.local`. Anchors and threads are stored in IndexedDB.

The current schema constants are:

```js
SETTINGS_KEY = "yacht.settings"
NAV_KEY_PREFIX = "yacht.nav."
SCHEMA_VERSION = 1
DB_NAME = "yacht-subthreads"
DB_VERSION = 2
```

Do not change these keys or versions casually. Existing users already have data stored under these names.

## 2. Storage Locations

YACHT uses these persistent storage locations:

| Storage | Key or database | Data |
| --- | --- | --- |
| `chrome.storage.local` | `SETTINGS_KEY` (`"yacht.settings"`) | User settings |
| `chrome.storage.local` | `${NAV_KEY_PREFIX}${conversationId}` | Last navigation mode for one conversation |
| IndexedDB | `DB_NAME` (`"yacht-subthreads"`) | Anchors and threads |

The content script loads data through background messages:

- `YACHT_GET_SETTINGS`
- `YACHT_GET_CONVERSATION_DATA`
- `YACHT_UPSERT_ANCHOR`
- `YACHT_UPSERT_THREAD`
- `YACHT_EXPORT_DATA`
- `YACHT_IMPORT_DATA`
- `YACHT_RESET_ALL_DATA`

The content script keeps a runtime copy at `state.data.anchors` and `state.data.threads`. That copy mirrors the persistent records for the active conversation.

## 3. Settings

Settings are persisted in `chrome.storage.local` under:

```js
SETTINGS_KEY = "yacht.settings"
```

The default settings are:

```json
{
  "schemaVersion": 1,
  "enabled": true,
  "sourceLinkStyle": {
    "color": "#111111",
    "underline": true
  }
}
```

`mergeSettings()` always returns settings with the current `SCHEMA_VERSION`. Unknown settings may remain because the function spreads the incoming object, but the active code only reads:

- `enabled`
- `sourceLinkStyle.color`
- `sourceLinkStyle.underline`
- `schemaVersion`

The popup has a fallback key named `"yachtSettings"` for cases where the background settings API does not respond. The main background-backed schema uses `SETTINGS_KEY`.

## 4. IndexedDB Database

Anchors and threads are stored in IndexedDB:

```js
DB_NAME = "yacht-subthreads"
DB_VERSION = 2
```

The database has two object stores.

### `anchors`

Key path:

```js
anchorId
```

Indexes:

- `byConversation` on `conversationId`
- `bySource` on `[conversationId, sourceMessageKey]`

### `threads`

Key path:

```js
threadId
```

Indexes:

- `byConversation` on `conversationId`
- `byAnchor` on `[conversationId, anchorId]`
- `byParent` on `[conversationId, parentThreadIndexKey]`

`parentThreadIndexKey` is an IndexedDB helper field. `normalizeRecordForStore()` adds it before a thread is written to the store.

## 5. Anchors

An anchor records a selected range inside an assistant message. It lets YACHT later restore the source link and connect that source text to one or more subthreads.

Anchors are created from `state.lastSelection` by `buildAnchorFromSelection()`. Existing anchors can be reused when the selected text, source message key, and offsets closely match.

Example anchor:

```json
{
  "schemaVersion": 1,
  "anchorId": "anchor_018fb7e1-1111-4222-8333-aaaaaaaaaaaa",
  "conversationId": "abc123",
  "sourceMessageKey": "message:msg_abc",
  "sourceMessageId": "msg_abc",
  "sourceRole": "assistant",
  "selectedText": "The selected answer text",
  "prefixText": "Text before the selection",
  "suffixText": "Text after the selection",
  "startOffset": 120,
  "endOffset": 144,
  "sourceHash": "9f86d081",
  "createdAt": "2026-05-05T00:00:00.000Z",
  "updatedAt": "2026-05-05T00:00:00.000Z"
}
```

Field notes:

- `sourceMessageKey` is the message key used by YACHT to find the source assistant message.
- `sourceMessageId` is the raw ChatGPT `data-message-id` when available, otherwise `null`.
- `sourceRole` is currently `"assistant"` for captured selections.
- `selectedText`, `prefixText`, `suffixText`, `startOffset`, `endOffset`, and `sourceHash` help restore the selected text range after the DOM changes.

## 6. Threads

A thread records an Ask ChatGPT follow-up created from an anchor. Threads are linked to anchors by `anchorId`.

Example public thread record:

```json
{
  "schemaVersion": 1,
  "threadId": "thread_018fb7e1-2222-4333-8444-bbbbbbbbbbbb",
  "conversationId": "abc123",
  "anchorId": "anchor_018fb7e1-1111-4222-8333-aaaaaaaaaaaa",
  "parentThreadId": null,
  "rootQuestionTitle": "What does this mean?",
  "rootUserMessageKey": "message:msg_user_1",
  "assistantMessageKeys": [
    "message:msg_assistant_1"
  ],
  "messageKeys": [
    "message:msg_user_1",
    "message:msg_assistant_1"
  ],
  "createdAt": "2026-05-05T00:01:00.000Z",
  "updatedAt": "2026-05-05T00:02:00.000Z"
}
```

Field notes:

- `threadId` is the primary key in the `threads` object store.
- `conversationId` scopes the thread to one ChatGPT conversation.
- `anchorId` links the thread to the source anchor.
- `parentThreadId` is `null` for a root-level subthread. It is set to the current thread ID when a subthread is created from inside another subthread.
- `rootQuestionTitle` is derived from the first user message in the Ask flow.
- `rootUserMessageKey` is the message key for that first user message.
- `messageKeys` is the ordered list of user and assistant message keys that belong to the thread.
- `assistantMessageKeys` is the ordered subset of assistant message keys in the thread.

`repairThreadMessageMappings()` and continuation reconciliation can update `messageKeys`, `assistantMessageKeys`, and `updatedAt` as the page reveals new matching turns.

## 7. Navigation State

Navigation state remembers whether a conversation was last viewed in the main thread or inside a subthread.

It is persisted in `chrome.storage.local` under:

```js
`${NAV_KEY_PREFIX}${conversationId}`
```

where:

```js
NAV_KEY_PREFIX = "yacht.nav."
```

Example:

```json
{
  "mode": "subthread",
  "currentThreadId": "thread_018fb7e1-2222-4333-8444-bbbbbbbbbbbb"
}
```

If the saved mode is `"subthread"` but `currentThreadId` no longer points to a loaded thread, YACHT resets navigation to:

```json
{
  "mode": "main",
  "currentThreadId": null
}
```

Related runtime fields include `state.mode`, `state.currentThreadId`, `state.subthreadKnownTurnKeys`, and `state.subthreadContinuationArmedUntil`.

## 8. Pending Ask Runtime State

`state.pendingAsk` is runtime-only. It is not stored permanently.

It exists while YACHT is waiting for ChatGPT to create the user turn and assistant reply for an Ask ChatGPT follow-up.

Runtime fields currently used in `state.pendingAsk` are:

- `anchor`
- `conversationId`
- `ownerMode`
- `ownerThreadId`
- `parentThreadId`
- `baselineKeys`
- `createdAt`
- `trigger`
- `threadId`
- `rootUserMessageKey`
- `unmatchedUserTurnSeenAt`

`baselineKeys` is a `Set`, not JSON storage data. It records message keys that existed before the Ask action so YACHT can detect newly added turns.

When the matching user turn is found, YACHT creates and persists:

- the anchor, through `YACHT_UPSERT_ANCHOR`
- the thread, through `YACHT_UPSERT_THREAD`

YACHT enters Subthread Mode as soon as that matching user turn is found. It does not wait for the assistant reply or for the IndexedDB write to finish before updating the current view.

When an assistant reply is found and attached to the thread, `state.pendingAsk` is cleared.

## 9. Message Keys

Message keys are generated by `getMessageKey()`.

When a ChatGPT message has `data-message-id`, the key is:

```text
message:<data-message-id>
```

When `data-message-id` is missing, YACHT uses a fallback key:

```text
fallback:<role>:<index>:<hash>
```

The fallback hash is based on normalized message text. Fallback keys are less stable than real message IDs because they depend on DOM order and visible text.

Important fields:

- `sourceMessageKey`: stored on anchors. It points to the assistant message that contained the selected source text.
- `sourceMessageId`: stored on anchors. It is the raw `data-message-id` when available.
- `rootUserMessageKey`: stored on threads. It is the first user message created by the Ask flow.
- `messageKeys`: stored on threads. It is the ordered set of messages that belong to the thread.
- `assistantMessageKeys`: stored on threads. It is the ordered assistant-only subset used for rendering and repair.

`deriveThreadMessageKeys()` starts from stored `messageKeys`, includes `rootUserMessageKey`, and adds assistant replies that follow included user messages until the next user message.

## 10. Import/Export Payload

The background export shape is:

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-05-05T00:10:00.000Z",
  "settings": {
    "schemaVersion": 1,
    "enabled": true,
    "sourceLinkStyle": {
      "color": "#111111",
      "underline": true
    }
  },
  "anchors": [
    {
      "schemaVersion": 1,
      "anchorId": "anchor_018fb7e1-1111-4222-8333-aaaaaaaaaaaa",
      "conversationId": "abc123",
      "sourceMessageKey": "message:msg_abc",
      "sourceMessageId": "msg_abc",
      "sourceRole": "assistant",
      "selectedText": "The selected answer text",
      "prefixText": "Text before the selection",
      "suffixText": "Text after the selection",
      "startOffset": 120,
      "endOffset": 144,
      "sourceHash": "9f86d081",
      "createdAt": "2026-05-05T00:00:00.000Z",
      "updatedAt": "2026-05-05T00:00:00.000Z"
    }
  ],
  "threads": [
    {
      "schemaVersion": 1,
      "threadId": "thread_018fb7e1-2222-4333-8444-bbbbbbbbbbbb",
      "conversationId": "abc123",
      "anchorId": "anchor_018fb7e1-1111-4222-8333-aaaaaaaaaaaa",
      "parentThreadId": null,
      "rootQuestionTitle": "What does this mean?",
      "rootUserMessageKey": "message:msg_user_1",
      "assistantMessageKeys": [
        "message:msg_assistant_1"
      ],
      "messageKeys": [
        "message:msg_user_1",
        "message:msg_assistant_1"
      ],
      "createdAt": "2026-05-05T00:01:00.000Z",
      "updatedAt": "2026-05-05T00:02:00.000Z"
    }
  ]
}
```

Export uses `stripInternalThreadFields()` for thread records. That means exported threads do not include `parentThreadIndexKey`.

Import requires `payload.schemaVersion` to equal `SCHEMA_VERSION`. Import supports two modes:

- `merge`: writes imported anchors and threads over matching primary keys without clearing existing records.
- `replace`: clears the `anchors` and `threads` stores before writing imported records.

When `payload.settings` exists, import saves it through `saveSettings()`.

## 11. Schema Versioning

`SCHEMA_VERSION` is currently `1`.

It appears in:

- default settings
- anchors
- threads
- export payloads
- import validation

`DB_VERSION` is currently `2`. It controls IndexedDB upgrade behavior, not the JSON export schema.

The IndexedDB upgrade creates stores and indexes when they are missing. For existing `threads` stores, the current upgrade logic recreates the `byParent` index on `[conversationId, parentThreadIndexKey]`.

## 12. Migration Warnings

Changing storage keys or schema requires careful migration.

Examples of risky changes:

- changing `SETTINGS_KEY`
- changing `NAV_KEY_PREFIX`
- changing `DB_NAME`
- changing object store names
- changing key paths such as `anchorId` or `threadId`
- changing index names or index key paths
- removing fields used to restore anchors or identify message ownership
- exporting internal-only fields as if they were public schema

`parentThreadIndexKey` is internal because it exists to make the `byParent` IndexedDB index work for both root threads and child threads. It is derived from public thread data:

```js
parentThreadIndexKey = record.parentThreadId || "__root__"
```

`normalizeRecordForStore()` adds this field before storing threads. Anchors are returned unchanged.

`stripInternalThreadFields()` removes `parentThreadIndexKey` before threads are returned to content scripts or included in exports. This keeps the public thread shape focused on actual application data instead of storage mechanics.

If a future schema needs different fields, add migration code that can read old records and write the new shape without losing existing anchors, threads, settings, or navigation state.

## 13. Debugging Stored Data

Useful places to inspect data:

- Extension service worker DevTools: IndexedDB database `yacht-subthreads`
- Extension service worker DevTools: `chrome.storage.local`
- Popup export: downloads the background export payload as JSON
- Console messages prefixed with `[Yacht]`

Common checks:

- Verify settings exist under `"yacht.settings"`.
- Verify navigation keys start with `"yacht.nav."`.
- Verify anchors are in the `anchors` object store and have `anchorId`.
- Verify threads are in the `threads` object store and have `threadId`.
- Verify stored thread records in IndexedDB may include `parentThreadIndexKey`.
- Verify exported thread records do not include `parentThreadIndexKey`.
- Verify `messageKeys` and `assistantMessageKeys` match the visible ChatGPT turns.
- Verify `sourceMessageKey` points to the assistant message containing the selected text.

Remember that `state.pendingAsk` is only visible while the page is running and an Ask flow is in progress. It is not part of persisted storage and will be lost on reload.
