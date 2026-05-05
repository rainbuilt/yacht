import { SUBTHREAD_CONTINUATION_ARM_MS } from "./constants.js";
import { findTurnInfoForMessageKey, readTurnInfos } from "./dom-readers.js";
import { state } from "./state.js";

export function findAnchor(anchorId) {
  return state.data.anchors.find((anchor) => anchor.anchorId === anchorId) ?? null;
}

export function findThread(threadId) {
  return state.data.threads.find((thread) => thread.threadId === threadId) ?? null;
}

export function threadsForAnchor(anchorId) {
  return state.data.threads
    .filter((thread) => thread.anchorId === anchorId)
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
}

export function anchorsWithThreads() {
  const anchorIds = new Set(state.data.threads.map((thread) => thread.anchorId));
  return state.data.anchors.filter((anchor) => anchorIds.has(anchor.anchorId));
}

export function effectiveMessageKeysForThread(thread, turns = readTurnInfos()) {
  return new Set(deriveThreadMessageKeys(thread, turns));
}

export function buildThreadKeyMap(turns = readTurnInfos()) {
  const order = new Map(turns.map((info, index) => [info.key, index]));
  const map = new Map();

  for (const thread of state.data.threads) {
    const messageKeys = deriveThreadMessageKeys(thread, turns, order);
    const assistantMessageKeys = turns
      .filter((info) => info.role === "assistant" && messageKeys.includes(info.key))
      .map((info) => info.key);
    map.set(thread.threadId, { messageKeys, assistantMessageKeys });
  }

  return map;
}

export function deriveThreadMessageKeys(
  thread,
  turns = readTurnInfos(),
  order = new Map(turns.map((info, index) => [info.key, index]))
) {
  const keys = new Set((thread.messageKeys ?? []).filter(Boolean));

  if (thread.rootUserMessageKey) {
    keys.add(thread.rootUserMessageKey);
  }

  for (let index = 0; index < turns.length; index += 1) {
    const info = turns[index];
    if (info.role !== "user" || !keys.has(info.key)) {
      continue;
    }

    for (let replyIndex = index + 1; replyIndex < turns.length; replyIndex += 1) {
      const reply = turns[replyIndex];
      if (reply.role === "user") {
        break;
      }
      if (reply.role === "assistant") {
        keys.add(reply.key);
      }
    }
  }

  return orderMessageKeys([...keys], order);
}

export function orderMessageKeys(keys, order) {
  const seen = new Set();
  const uniqueKeys = keys.filter((key) => {
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  return uniqueKeys.sort((left, right) => {
    const leftIndex = order.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = order.get(right) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex || String(left).localeCompare(String(right));
  });
}

export function setSubthreadBaselineFromCurrentTurns(turns = readTurnInfos()) {
  state.subthreadKnownTurnKeys = new Set(turns.map((info) => info.key));
}

export function armSubthreadContinuation() {
  if (state.mode !== "subthread" || !state.currentThreadId || state.pendingAsk) {
    return;
  }

  state.subthreadContinuationArmedUntil = Date.now() + SUBTHREAD_CONTINUATION_ARM_MS;
}

export function getCurrentThreadContext(turns = readTurnInfos()) {
  const messageTurns = turns.filter((info) => info.role === "user" || info.role === "assistant");
  if (messageTurns.length === 0) {
    return null;
  }

  const currentKeys =
    state.mode === "subthread"
      ? getCurrentSubthreadKeys(messageTurns)
      : getCurrentMainThreadKeys(messageTurns);

  if (!currentKeys?.size) {
    return null;
  }

  const latestTurn = messageTurns.at(-1);
  const lastAssistant = [...messageTurns]
    .reverse()
    .find((info) => info.role === "assistant" && currentKeys.has(info.key));

  if (!latestTurn || !lastAssistant) {
    return null;
  }

  return {
    turns: messageTurns,
    currentKeys,
    latestTurn,
    lastAssistant,
    isAtTail: currentKeys.has(latestTurn.key)
  };
}

export function getCurrentSubthreadKeys(turns = readTurnInfos()) {
  const thread = findThread(state.currentThreadId);
  if (!thread) {
    return new Set();
  }

  return effectiveMessageKeysForThread(thread, turns);
}

export function getCurrentMainThreadKeys(turns = readTurnInfos()) {
  const hiddenKeys = new Set(
    [...buildThreadKeyMap(turns).values()].flatMap(({ messageKeys }) => messageKeys)
  );
  return new Set(turns.filter((info) => !hiddenKeys.has(info.key)).map((info) => info.key));
}

export function isMessageKeyInCurrentThread(messageKey, turns = readTurnInfos()) {
  if (!messageKey) {
    return false;
  }

  const currentKeys =
    state.mode === "subthread" ? getCurrentSubthreadKeys(turns) : getCurrentMainThreadKeys(turns);
  if (currentKeys.has(messageKey)) {
    return true;
  }

  const owningTurnInfo = findTurnInfoForMessageKey(messageKey, turns);
  return Boolean(owningTurnInfo && currentKeys.has(owningTurnInfo.key));
}

export function allOtherThreadMessageKeys(threadId, turns = readTurnInfos()) {
  const keys = new Set();

  for (const thread of state.data.threads) {
    if (thread.threadId === threadId) {
      continue;
    }

    for (const key of effectiveMessageKeysForThread(thread, turns)) {
      keys.add(key);
    }
  }

  return keys;
}

export function findDirectParentThread(thread, anchor, turns = readTurnInfos()) {
  const explicitParent = findThread(thread.parentThreadId);
  if (explicitParent) {
    return explicitParent;
  }

  if (!anchor?.sourceMessageKey) {
    return null;
  }

  const owningTurnKey = findTurnInfoForMessageKey(anchor.sourceMessageKey, turns)?.key ?? null;

  return (
    state.data.threads.find(
      (candidate) =>
        candidate.threadId !== thread.threadId &&
        ((candidate.messageKeys ?? []).includes(anchor.sourceMessageKey) ||
          (owningTurnKey && (candidate.messageKeys ?? []).includes(owningTurnKey)))
    ) ?? null
  );
}
