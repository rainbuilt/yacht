import { NAV_KEY_PREFIX } from "./constants.js";
import { state, resetThreadNavigationState } from "./state.js";
import { mergeSettings } from "./utils.js";
import { findThread } from "./thread-model.js";

export function currentNavKey() {
  return `${NAV_KEY_PREFIX}${state.conversationId}`;
}

export async function sendRuntime(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });

  if (!response?.ok) {
    throw new Error(response?.error ?? `Runtime message failed: ${type}`);
  }

  return response;
}

export async function loadSettings() {
  const response = await sendRuntime("YACHT_GET_SETTINGS");
  state.settings = mergeSettings(response.settings);
}

export async function loadConversationData() {
  const response = await sendRuntime("YACHT_GET_CONVERSATION_DATA", {
    conversationId: state.conversationId
  });

  state.data = {
    anchors: response.data?.anchors ?? [],
    threads: response.data?.threads ?? []
  };
}

export async function loadNavigationState() {
  const stored = await chrome.storage.local.get({
    [currentNavKey()]: {
      mode: "main",
      currentThreadId: null
    }
  });
  const nav = stored[currentNavKey()];

  if (nav?.mode === "subthread" && findThread(nav.currentThreadId)) {
    state.mode = "subthread";
    state.currentThreadId = nav.currentThreadId;
    state.subthreadKnownTurnKeys = null;
    state.subthreadContinuationArmedUntil = 0;
    return;
  }

  resetThreadNavigationState();
}

export function scheduleSaveNavigationState() {
  clearTimeout(state.saveNavTimer);
  state.saveNavTimer = setTimeout(() => {
    chrome.storage.local.set({
      [currentNavKey()]: {
        mode: state.mode,
        currentThreadId: state.currentThreadId
      }
    });
  }, 100);
}
