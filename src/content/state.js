import { DEFAULT_SETTINGS, HEADER_MOUNT_DELAY_MS } from "./constants.js";
import { getConversationId } from "./utils.js";

export const state = {
  initialized: false,
  conversationId: getConversationId(),
  settings: DEFAULT_SETTINGS,
  data: {
    anchors: [],
    threads: []
  },
  mode: "main",
  currentThreadId: null,
  pendingAsk: null,
  lastSelection: null,
  mutationObserver: null,
  routeTimer: null,
  renderTimer: null,
  renderingTimer: null,
  deferredMutationTimer: null,
  headerMountTimer: null,
  headerMountAllowedAt: Date.now() + HEADER_MOUNT_DELAY_MS,
  saveNavTimer: null,
  scrollTimers: [],
  scrollToken: 0,
  appliedStyleSignature: "",
  renderedSourceSignature: "",
  subthreadKnownTurnKeys: null,
  subthreadContinuationArmedUntil: 0,
  rendering: false,
  failSafe: false,
  diagnostic: "",
  repliedContentActive: false,
  autoContextInProgress: false,
  allowNextSendClickUntil: 0,
  suppressSelectionCaptureUntil: 0,
  suppressAskButtonCaptureUntil: 0,
  suppressRepliedContentAskUntil: 0,
  suppressHeaderClickUntil: 0,
  suppressSourceClickUntil: 0
};

export function resetThreadNavigationState() {
  state.mode = "main";
  state.currentThreadId = null;
  state.subthreadKnownTurnKeys = null;
  state.subthreadContinuationArmedUntil = 0;
}
