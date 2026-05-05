import {
  AUTO_CONTEXT_IGNORE_SELECTOR,
  AUTO_CONTEXT_SUPPRESS_MS,
  AUTO_CONTEXT_WAIT_MS,
  BLOCK_SOURCE_LINK_SELECTOR,
  PENDING_ASK_TIMEOUT_MS,
  POST_RENDER_SCROLL_DELAYS_MS,
  SCHEMA_VERSION,
  SELECTORS,
  SETTINGS_KEY,
  SUBTHREAD_CONTINUATION_ARM_MS,
  TEXT_BLOCK_SELECTOR,
  UNMATCHED_USER_TURN_GRACE_MS,
  UNSAFE_SOURCE_LINK_SELECTOR
} from "./constants.js";
import {
  getUserQuestionText,
  getUserReferenceTexts,
  isAskUserTurnForAnchor,
  readTurnInfos
} from "./dom-readers.js";
import { probeDom, setDiagnostic } from "./diagnostics.js";
import { registerDocumentEvents } from "./events.js";
import { observeDom } from "./observers.js";
import {
  loadConversationData,
  loadSettings,
  loadNavigationState,
  scheduleSaveNavigationState,
  sendRuntime
} from "./persistence.js";
import { buildAnchorFromSelection, captureSelection } from "./selection.js";
import { state } from "./state.js";
import {
  allOtherThreadMessageKeys,
  anchorsWithThreads,
  armSubthreadContinuation,
  buildThreadKeyMap,
  deriveThreadMessageKeys,
  effectiveMessageKeysForThread,
  findAnchor,
  findDirectParentThread,
  findThread,
  getCurrentThreadContext,
  isMessageKeyInCurrentThread,
  setSubthreadBaselineFromCurrentTurns,
  threadsForAnchor
} from "./thread-model.js";
import {
  createId,
  getConversationId,
  mergeSettings,
  nodeElement,
  normalizeText,
  normalizeWithRawMap,
  shortTitle,
  textFromNodes,
  textNodesUnder
} from "./utils.js";

function isPendingAskOwnerActive(pending) {
  return (
    pending?.conversationId === state.conversationId &&
    pending.ownerMode === state.mode &&
    pending.ownerThreadId === state.currentThreadId
  );
}

function repairThreadMessageMappings(turns = readTurnInfos(), threadKeyMap = buildThreadKeyMap(turns)) {
  for (const thread of state.data.threads) {
    const { messageKeys, assistantMessageKeys } = threadKeyMap.get(thread.threadId) ?? {
      messageKeys: [],
      assistantMessageKeys: []
    };
    const changed =
      messageKeys.join("|") !== (thread.messageKeys ?? []).join("|") ||
      assistantMessageKeys.join("|") !== (thread.assistantMessageKeys ?? []).join("|");

    if (!changed) {
      continue;
    }

    persistThread({
      ...thread,
      assistantMessageKeys,
      messageKeys,
      updatedAt: new Date().toISOString()
    }).catch((error) => console.error("[Yacht] failed to repair thread mapping", error));
  }
}

function isComposerInteractionTarget(target) {
  const element = nodeElement(target);
  return Boolean(element?.closest(SELECTORS.composerContainer));
}

function isPlainEnterSend(event) {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.isComposing
  );
}

function getAssistantContextRoot(turnInfo) {
  return turnInfo?.turn ?? turnInfo?.message ?? null;
}

function shouldAttachAutoContext() {
  if (
    !state.settings.enabled ||
    state.failSafe ||
    state.autoContextInProgress ||
    hasActiveRepliedContent()
  ) {
    return false;
  }

  const context = getCurrentThreadContext();
  return Boolean(
    context &&
      !context.isAtTail &&
      findLastAnswerContextRange(getAssistantContextRoot(context.lastAssistant))
  );
}

async function ensureAutoContextForCurrentThread() {
  const context = getCurrentThreadContext();
  if (
    !context?.lastAssistant ||
    context.isAtTail ||
    hasActiveRepliedContent()
  ) {
    return false;
  }

  const range = findLastAnswerContextRange(getAssistantContextRoot(context.lastAssistant));
  if (!range) {
    return false;
  }

  state.autoContextInProgress = true;
  const suppressUntil = Date.now() + AUTO_CONTEXT_SUPPRESS_MS;
  state.suppressSelectionCaptureUntil = suppressUntil;
  state.suppressAskButtonCaptureUntil = suppressUntil;
  state.suppressRepliedContentAskUntil = suppressUntil;

  try {
    selectRangeForNativeAsk(range);
    const askButton = await waitForElement(findNativeAskButton, AUTO_CONTEXT_WAIT_MS);

    if (!askButton) {
      return false;
    }

    askButton.click();
    const repliedContent = await waitForElement(
      () => hasActiveRepliedContent(),
      AUTO_CONTEXT_WAIT_MS
    );
    return Boolean(repliedContent);
  } finally {
    window.getSelection()?.removeAllRanges();
    focusComposer();
    state.autoContextInProgress = false;
  }
}

function findLastAnswerContextRange(message) {
  const container = findLastTextContainer(message);
  if (!container) {
    return null;
  }

  const textNodes = textNodesUnder(container).filter(
    (node) => normalizeText(node.nodeValue).length > 0
  );
  if (textNodes.length === 0) {
    return null;
  }

  const range = document.createRange();
  range.setStart(textNodes[0], 0);
  range.setEnd(textNodes.at(-1), textNodes.at(-1).nodeValue.length);
  return range.collapsed ? null : range;
}

function findLastTextContainer(message) {
  if (!message) {
    return null;
  }

  const candidates = [...message.querySelectorAll(TEXT_BLOCK_SELECTOR)].filter(
    (node) =>
      normalizeText(node.textContent).length > 0 &&
      isVisibleElement(node) &&
      !node.closest(AUTO_CONTEXT_IGNORE_SELECTOR)
  );

  return candidates.at(-1) ?? (normalizeText(message.textContent).length > 0 ? message : null);
}

function selectRangeForNativeAsk(range) {
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));

  const rect = range.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const target = document.elementFromPoint(clientX, clientY) ?? document;
    target.dispatchEvent(
      new MouseEvent("mouseup", {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
        button: 0
      })
    );
  }
}

function findNativeAskButton() {
  return [...document.querySelectorAll("button")]
    .filter((button) => !button.closest(".yacht-header-controls, .yacht-popover"))
    .find((button) => isAskButtonLike(button) && isVisibleElement(button));
}

function waitForElement(resolveElement, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();

    function check() {
      const element = resolveElement();
      if (element) {
        resolve(element);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        resolve(null);
        return;
      }

      window.setTimeout(check, 80);
    }

    check();
  });
}

function focusComposer() {
  const composer =
    document.querySelector(`${SELECTORS.composerContainer} [contenteditable="true"]`) ??
    document.querySelector(SELECTORS.composerContainer);
  composer?.focus?.();
}

function hasActiveRepliedContent() {
  return Boolean(
    document.querySelector(SELECTORS.repliedContent) ||
      document.querySelector(
        `${SELECTORS.composerContainer} :is(button, [role="button"]):has(p.line-clamp-3)`
      )
  );
}

async function handleSendWithAutoContext(sendButton) {
  if (!shouldAttachAutoContext()) {
    return false;
  }

  if (state.pendingAsk && !hasActiveRepliedContent()) {
    state.pendingAsk = null;
  }

  state.autoContextInProgress = true;

  try {
    await ensureAutoContextForCurrentThread();
  } catch (error) {
    console.debug("[Yacht] failed to attach auto Ask context", error);
  } finally {
    state.autoContextInProgress = false;
  }

  state.allowNextSendClickUntil = Date.now() + 1200;
  window.setTimeout(() => {
    const nextSendButton =
      document.querySelector(SELECTORS.sendButton) ?? sendButton;
    nextSendButton?.click?.();
  }, 80);
  return true;
}

function applyStyleSettings() {
  const { color, underline } = state.settings.sourceLinkStyle;
  const signature = `${color}|${underline}`;
  if (state.appliedStyleSignature === signature) {
    return;
  }

  document.documentElement.style.setProperty("--yacht-link-color", color);
  document
    .querySelectorAll(".yacht-source-link")
    .forEach((node) => {
      node.dataset.yachtUnderline = String(Boolean(underline));
    });
  state.appliedStyleSignature = signature;
}

function mountHeaderControls() {
  const remainingDelay = state.headerMountAllowedAt - Date.now();
  if (remainingDelay > 0) {
    clearTimeout(state.headerMountTimer);
    state.headerMountTimer = setTimeout(scheduleRender, remainingDelay);
    return;
  }

  const mountPoint = findHeaderMountPoint();
  if (!mountPoint) {
    return;
  }

  let root = document.querySelector(".yacht-header-controls");

  if (!root) {
    root = document.createElement("div");
    root.className = "yacht-header-controls";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "yacht-toggle";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-label", "Toggle YACHT");
    toggle.dataset.yachtControl = "toggle";

    const label = document.createElement("span");
    label.className = "yacht-sr-only";
    label.textContent = "Subthreads";

    const track = document.createElement("span");
    track.className = "yacht-toggle__track";
    track.setAttribute("aria-hidden", "true");

    toggle.append(label, track);

    const back = document.createElement("button");
    back.type = "button";
    back.className = "yacht-header-button";
    back.dataset.yachtControl = "back";
    back.setAttribute("aria-label", "Return to source");
    back.title = "Return to source";

    const backIcon = document.createElement("span");
    backIcon.className = "yacht-header-button__icon";
    backIcon.setAttribute("aria-hidden", "true");
    backIcon.textContent = "↩";
    back.append(backIcon);

    root.append(toggle, back);
  }

  if (!placeHeaderControls(root, mountPoint)) {
    clearTimeout(state.headerMountTimer);
    state.headerMountTimer = setTimeout(scheduleRender, 120);
    return;
  }

  updateHeaderControls();
}

function placeHeaderControls(root, { parent, before }) {
  if (!parent?.isConnected) {
    return false;
  }

  const reference = before?.parentNode === parent && before !== root ? before : null;
  if (root.parentElement === parent && (!reference || root.nextElementSibling === reference)) {
    return true;
  }

  try {
    parent.insertBefore(root, reference);
    return true;
  } catch (error) {
    console.debug("[Yacht] deferred header control mount", error);
    return false;
  }
}

function updateHeaderControls() {
  const root = document.querySelector(".yacht-header-controls");
  if (!root) {
    return;
  }

  const toggle = root.querySelector('[data-yacht-control="toggle"]');
  const back = root.querySelector('[data-yacht-control="back"]');
  toggle?.setAttribute("aria-checked", String(Boolean(state.settings.enabled)));

  if (back) {
    back.hidden = !state.settings.enabled || state.mode !== "subthread" || !state.currentThreadId;
  }
}

function findHeaderMountPoint() {
  const header = document.querySelector(SELECTORS.header) ?? document;
  const parent =
    header.querySelector(SELECTORS.headerActions) ??
    header.querySelector(SELECTORS.headerActionsFallback);

  if (!parent) {
    return null;
  }

  const shareButton = parent.querySelector(SELECTORS.shareButton);
  const optionsButton = parent.querySelector(SELECTORS.optionsButton);

  if (isVisibleElement(shareButton)) {
    return { parent, before: shareButton };
  }

  if (isVisibleElement(optionsButton)) {
    return { parent, before: optionsButton };
  }

  return { parent, before: parent.firstChild };
}

function isVisibleElement(element) {
  if (!element) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

async function setEnabled(enabled) {
  state.settings = mergeSettings({
    ...state.settings,
    enabled
  });
  await sendRuntime("YACHT_SAVE_SETTINGS", { settings: state.settings });

  if (!enabled) {
    state.pendingAsk = null;
    state.lastSelection = null;
    state.mode = "main";
    state.currentThreadId = null;
    state.subthreadKnownTurnKeys = null;
    state.subthreadContinuationArmedUntil = 0;
    scheduleSaveNavigationState();
  } else {
    await loadConversationData();
    await loadNavigationState();
  }

  scheduleRenderPasses();
}

function createPendingAsk(trigger) {
  if (
    !state.settings.enabled ||
    state.failSafe ||
    !state.lastSelection ||
    state.autoContextInProgress ||
    Date.now() < state.suppressAskButtonCaptureUntil ||
    Date.now() < state.suppressRepliedContentAskUntil
  ) {
    return;
  }

  const turns = readTurnInfos();
  if (!isMessageKeyInCurrentThread(state.lastSelection.sourceMessageKey, turns)) {
    state.lastSelection = null;
    return;
  }

  const anchor = buildAnchorFromSelection(state.lastSelection);
  state.pendingAsk = {
    anchor,
    conversationId: state.conversationId,
    ownerMode: state.mode,
    ownerThreadId: state.currentThreadId,
    parentThreadId: state.mode === "subthread" ? state.currentThreadId : null,
    baselineKeys: new Set(turns.map((info) => info.key)),
    createdAt: Date.now(),
    trigger,
    threadId: null,
    rootUserMessageKey: null,
    unmatchedUserTurnSeenAt: null
  };

  schedulePendingReconcile();
}

async function persistAnchor(anchor) {
  const existingIndex = state.data.anchors.findIndex(
    (record) => record.anchorId === anchor.anchorId
  );

  if (existingIndex >= 0) {
    state.data.anchors[existingIndex] = anchor;
  } else {
    state.data.anchors.push(anchor);
  }

  await sendRuntime("YACHT_UPSERT_ANCHOR", { anchor });
}

async function persistThread(thread) {
  const existingIndex = state.data.threads.findIndex(
    (record) => record.threadId === thread.threadId
  );

  if (existingIndex >= 0) {
    state.data.threads[existingIndex] = thread;
  } else {
    state.data.threads.push(thread);
  }

  await sendRuntime("YACHT_UPSERT_THREAD", { thread });
}

function reconcilePendingAsk(turns = readTurnInfos()) {
  if (!state.pendingAsk) {
    return;
  }

  const pending = state.pendingAsk;

  if (!pending.rootUserMessageKey) {
    if (!isPendingAskOwnerActive(pending)) {
      state.pendingAsk = null;
      return;
    }

    const newUserTurns = turns.filter(
      (info) => info.role === "user" && !pending.baselineKeys.has(info.key)
    );
    const userTurn = newUserTurns.find((info) => isAskUserTurnForAnchor(info, pending.anchor));

    if (!userTurn) {
      const now = Date.now();
      if (newUserTurns.length > 0) {
        pending.unmatchedUserTurnSeenAt ??= now;
      }

      const hasReferenceUserTurn = newUserTurns.some(
        (info) => getUserReferenceTexts(info.message).length > 0
      );
      const shouldClearPlainUserTurn =
        newUserTurns.length > 0 &&
        !hasReferenceUserTurn &&
        now - pending.unmatchedUserTurnSeenAt > UNMATCHED_USER_TURN_GRACE_MS;

      if (shouldClearPlainUserTurn || now - pending.createdAt > PENDING_ASK_TIMEOUT_MS) {
        state.pendingAsk = null;
      }
      return;
    }

    const now = new Date().toISOString();
    const thread = {
      schemaVersion: SCHEMA_VERSION,
      threadId: createId("thread"),
      conversationId: state.conversationId,
      anchorId: pending.anchor.anchorId,
      parentThreadId: pending.parentThreadId,
      rootQuestionTitle: getUserQuestionText(userTurn.message),
      rootUserMessageKey: userTurn.key,
      assistantMessageKeys: [],
      messageKeys: [userTurn.key],
      createdAt: now,
      updatedAt: now
    };

    pending.threadId = thread.threadId;
    pending.rootUserMessageKey = userTurn.key;

    Promise.all([persistAnchor(pending.anchor), persistThread(thread)])
      .then(() => {
        navigateToThread(thread.threadId);
      })
      .catch((error) => {
        console.error("[Yacht] failed to persist new Ask thread", error);
      });
  }

  if (!pending.threadId || !pending.rootUserMessageKey) {
    return;
  }

  const thread = findThread(pending.threadId);
  const rootIndex = turns.findIndex((info) => info.key === pending.rootUserMessageKey);
  if (!thread || rootIndex < 0) {
    return;
  }

  const assistantMessageKeys = [];
  for (const info of turns.slice(rootIndex + 1)) {
    if (info.role === "user") {
      break;
    }
    if (info.role === "assistant") {
      assistantMessageKeys.push(info.key);
    }
  }

  const nextMessageKeys = [thread.rootUserMessageKey, ...assistantMessageKeys];
  const changed =
    nextMessageKeys.join("|") !== (thread.messageKeys ?? []).join("|") ||
    assistantMessageKeys.join("|") !== (thread.assistantMessageKeys ?? []).join("|");

  if (changed) {
    thread.assistantMessageKeys = assistantMessageKeys;
    thread.messageKeys = nextMessageKeys;
    thread.updatedAt = new Date().toISOString();
    persistThread(thread)
      .then(scheduleRender)
      .catch((error) => console.error("[Yacht] failed to update Ask thread", error));
  }

  if (assistantMessageKeys.length > 0) {
    state.pendingAsk = null;
  }
}

function schedulePendingReconcile() {
  window.setTimeout(reconcilePendingAsk, 200);
  window.setTimeout(reconcilePendingAsk, 900);
  window.setTimeout(reconcilePendingAsk, 2200);
}

function reconcileSubthreadContinuations(turns = readTurnInfos()) {
  if (
    !state.settings.enabled ||
    state.failSafe ||
    state.mode !== "subthread" ||
    !state.currentThreadId
  ) {
    return;
  }

  const thread = findThread(state.currentThreadId);
  if (!thread) {
    return;
  }

  if (!state.subthreadKnownTurnKeys) {
    setSubthreadBaselineFromCurrentTurns(turns);
    return;
  }

  if (state.pendingAsk || Date.now() > state.subthreadContinuationArmedUntil) {
    return;
  }

  const currentKeys = effectiveMessageKeysForThread(thread, turns);
  const lastCurrentIndex = turns.reduce(
    (lastIndex, info, index) => (currentKeys.has(info.key) ? index : lastIndex),
    -1
  );

  if (lastCurrentIndex < 0) {
    return;
  }

  const otherThreadKeys = allOtherThreadMessageKeys(thread.threadId, turns);
  const newKeys = [];

  for (const info of turns.slice(lastCurrentIndex + 1)) {
    const wasKnown = state.subthreadKnownTurnKeys.has(info.key);
    if (wasKnown) {
      continue;
    }

    if (otherThreadKeys.has(info.key) || (info.role !== "user" && info.role !== "assistant")) {
      state.subthreadKnownTurnKeys.add(info.key);
      continue;
    }

    if (newKeys.includes(info.key) || (thread.messageKeys ?? []).includes(info.key)) {
      state.subthreadKnownTurnKeys.add(info.key);
      continue;
    }

    newKeys.push(info.key);
  }

  if (newKeys.length === 0) {
    return;
  }

  for (const key of newKeys) {
    state.subthreadKnownTurnKeys.add(key);
  }
  state.subthreadContinuationArmedUntil = Date.now() + SUBTHREAD_CONTINUATION_ARM_MS;

  const messageKeys = deriveThreadMessageKeys(
    {
      ...thread,
      messageKeys: [...(thread.messageKeys ?? []), ...newKeys]
    },
    turns
  );
  const assistantMessageKeys = turns
    .filter((info) => info.role === "assistant" && messageKeys.includes(info.key))
    .map((info) => info.key);

  thread.messageKeys = messageKeys;
  thread.assistantMessageKeys = assistantMessageKeys;
  thread.updatedAt = new Date().toISOString();

  persistThread(thread)
    .then(scheduleRender)
    .catch((error) => console.error("[Yacht] failed to append subthread continuation", error));
}

function isAskButtonLike(button) {
  const label = normalizeText(
    `${button.getAttribute("aria-label") ?? ""} ${button.title ?? ""} ${
      button.textContent ?? ""
    }`
  ).toLowerCase();

  return label.includes("ask chatgpt") || label === "ask";
}

function handleDocumentPointerDown(event) {
  if (!isPrimaryPointer(event)) {
    return;
  }

  if (isComposerInteractionTarget(event.target)) {
    armSubthreadContinuation();
  }

  const headerControl = headerControlFromEvent(event);
  if (headerControl) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    state.suppressHeaderClickUntil = Date.now() + 600;
    activateHeaderControl(headerControl);
    return;
  }

  if (!state.settings.enabled || state.failSafe) {
    return;
  }

  const anchor = sourceAnchorFromEvent(event);
  if (!anchor) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  state.suppressSourceClickUntil = Date.now() + 600;
  openAnchor(anchor.anchorId, event);
}

function isPrimaryPointer(event) {
  return event.pointerType && event.pointerType !== "mouse"
    ? event.isPrimary !== false
    : event.button === 0;
}

function handleDocumentClick(event) {
  const target = nodeElement(event.target);
  if (!target) {
    return;
  }

  const sendButton = target.closest(SELECTORS.sendButton);
  if (sendButton) {
    if (Date.now() < state.allowNextSendClickUntil) {
      return;
    }

    if (shouldAttachAutoContext()) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      handleSendWithAutoContext(sendButton);
      return;
    }
  }

  const headerControl = target.closest(".yacht-header-controls [data-yacht-control]");
  if (headerControl) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    if (Date.now() < state.suppressHeaderClickUntil) {
      return;
    }
    activateHeaderControl(headerControl);
    return;
  }

  const sourceLink = target.closest(".yacht-source-link");
  if (sourceLink) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    if (Date.now() < state.suppressSourceClickUntil) {
      return;
    }
    openAnchor(sourceLink.dataset.anchorId, event);
    return;
  }

  const clickedAnchor = sourceAnchorFromEvent(event);
  if (clickedAnchor) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    if (Date.now() < state.suppressSourceClickUntil) {
      return;
    }
    openAnchor(clickedAnchor.anchorId, event);
    return;
  }

  if (!target.closest(".yacht-popover")) {
    closeThreadChooser();
  }

  const referenceButton = target.closest(SELECTORS.userReferenceButton);
  if (
    referenceButton &&
    state.settings.enabled &&
    state.mode === "subthread" &&
    state.currentThreadId
  ) {
    event.preventDefault();
    event.stopPropagation();
    returnToSource();
    return;
  }

  const removeButton = target.closest(SELECTORS.removeRepliedContent);
  if (removeButton && state.pendingAsk) {
    state.pendingAsk = null;
    return;
  }

  const clickedControl = target.closest("button, [role='button']");
  if (clickedControl && isAskButtonLike(clickedControl)) {
    if (Date.now() < state.suppressAskButtonCaptureUntil) {
      return;
    }
    if (!state.lastSelection) {
      return;
    }
    createPendingAsk("ask-button-click");
    return;
  }

  if (
    clickedControl &&
    state.lastSelection &&
    Date.now() >= state.suppressAskButtonCaptureUntil
  ) {
    window.setTimeout(() => {
      if (!state.pendingAsk && hasActiveRepliedContent()) {
        createPendingAsk("replied-content-click");
      }
    }, 120);
  }
}

function handleDocumentInput(event) {
  if (isComposerInteractionTarget(event.target)) {
    armSubthreadContinuation();
  }
}

function handleDocumentKeyDown(event) {
  if (isComposerInteractionTarget(event.target)) {
    armSubthreadContinuation();

    if (
      isPlainEnterSend(event) &&
      Date.now() >= state.allowNextSendClickUntil &&
      shouldAttachAutoContext()
    ) {
      const sendButton = document.querySelector(SELECTORS.sendButton);
      if (!sendButton) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      handleSendWithAutoContext(sendButton);
    }
  }
}

function headerControlFromEvent(event) {
  const target = nodeElement(event.target);
  return target?.closest?.(".yacht-header-controls [data-yacht-control]") ?? null;
}

function activateHeaderControl(control) {
  const controlName = control?.dataset?.yachtControl;

  if (controlName === "toggle") {
    setEnabled(!state.settings.enabled).catch((error) => {
      console.error("[Yacht] failed to toggle header control", error);
    });
    return true;
  }

  if (controlName === "back" && state.settings.enabled && state.mode === "subthread") {
    returnToSource();
    return true;
  }

  return false;
}

function sourceAnchorFromEvent(event) {
  if (!state.settings.enabled || state.failSafe) {
    return null;
  }

  const target = nodeElement(event.target);
  const sourceLink = target?.closest?.(".yacht-source-link");
  if (sourceLink) {
    return findAnchor(sourceLink.dataset.anchorId);
  }

  if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
    return null;
  }

  return findAnchorAtPoint(event.clientX, event.clientY);
}

function openAnchor(anchorId, event) {
  const threads = threadsForAnchor(anchorId);

  if (threads.length === 0) {
    return;
  }

  if (threads.length === 1) {
    navigateToThread(threads[0].threadId);
    return;
  }

  showThreadChooser(anchorId, event);
}

function showThreadChooser(anchorId, event) {
  closeThreadChooser();
  const threads = threadsForAnchor(anchorId);
  const popover = document.createElement("div");
  popover.className = "yacht-popover";
  popover.setAttribute("role", "menu");

  for (const thread of threads) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "yacht-popover__item";
    item.setAttribute("role", "menuitem");

    const title = document.createElement("span");
    title.className = "yacht-popover__title";
    title.textContent = shortTitle(thread.rootQuestionTitle || "Ask ChatGPT follow-up");

    const time = document.createElement("span");
    time.className = "yacht-popover__time";
    time.textContent = formatDate(thread.createdAt);

    item.append(title, time);
    item.addEventListener("click", () => {
      closeThreadChooser();
      navigateToThread(thread.threadId);
    });
    popover.append(item);
  }

  document.documentElement.append(popover);
  const width = 340;
  const left = Math.min(event.clientX, window.innerWidth - width - 12);
  const top = Math.min(event.clientY + 8, window.innerHeight - 300);
  popover.style.left = `${Math.max(12, left)}px`;
  popover.style.top = `${Math.max(12, top)}px`;
}

function closeThreadChooser() {
  document.querySelector(".yacht-popover")?.remove();
}

function formatDate(value) {
  if (!value) {
    return "";
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function navigateToThread(threadId) {
  if (!findThread(threadId)) {
    return;
  }

  state.mode = "subthread";
  state.currentThreadId = threadId;
  setSubthreadBaselineFromCurrentTurns();
  state.subthreadContinuationArmedUntil = 0;
  scheduleSaveNavigationState();
  scheduleRender();
  queueScrollToThread(threadId);
}

function returnToSource() {
  const thread = findThread(state.currentThreadId);
  if (!thread) {
    state.mode = "main";
    state.currentThreadId = null;
    scheduleSaveNavigationState();
    scheduleRender();
    return;
  }

  const anchor = findAnchor(thread.anchorId);
  const parent = findDirectParentThread(thread, anchor);

  if (parent) {
    state.mode = "subthread";
    state.currentThreadId = parent.threadId;
    setSubthreadBaselineFromCurrentTurns();
    state.subthreadContinuationArmedUntil = 0;
  } else {
    state.mode = "main";
    state.currentThreadId = null;
    state.subthreadKnownTurnKeys = null;
    state.subthreadContinuationArmedUntil = 0;
  }

  scheduleSaveNavigationState();
  scheduleRender();
  queueScrollToAnchor(anchor?.anchorId ?? thread.anchorId);
}

function queueScrollToThread(threadId) {
  queuePostRenderScroll(() => findThreadScrollTarget(threadId));
}

function queueScrollToAnchor(anchorId) {
  queuePostRenderScroll(() => findAnchorScrollTarget(anchorId));
}

function queuePostRenderScroll(resolveTarget) {
  clearQueuedScroll();
  const token = state.scrollToken + 1;
  state.scrollToken = token;

  POST_RENDER_SCROLL_DELAYS_MS.forEach((delay, index) => {
    const timer = setTimeout(() => {
      if (token !== state.scrollToken) {
        return;
      }

      requestAnimationFrame(() => {
        if (token !== state.scrollToken) {
          return;
        }

        const target = resolveTarget();
        if (!target) {
          scheduleRender();
          return;
        }

        scrollTargetIntoView(target, index === 0 ? "smooth" : "auto");

        if (isScrollTargetInView(target)) {
          clearQueuedScroll();
        }
      });
    }, delay);

    state.scrollTimers.push(timer);
  });
}

function clearQueuedScroll() {
  for (const timer of state.scrollTimers) {
    clearTimeout(timer);
  }

  state.scrollTimers = [];
}

function findThreadScrollTarget(threadId, turns = readTurnInfos()) {
  const thread = findThread(threadId);
  const firstKey = thread?.messageKeys?.[0];
  if (!firstKey) {
    return null;
  }

  const turn = turns.find((info) => info.key === firstKey)?.turn ?? null;
  return isVisibleScrollTarget(turn) ? turn : null;
}

function findAnchorScrollTarget(anchorId) {
  if (!anchorId) {
    return null;
  }

  const links = [...document.querySelectorAll(
    `.yacht-source-link[data-anchor-id="${CSS.escape(anchorId)}"]`
  )];
  const link = links.find(isVisibleScrollTarget);

  if (link) {
    return link;
  }

  const anchor = findAnchor(anchorId);
  const message = anchor ? findSourceMessage(anchor) : null;
  return isVisibleScrollTarget(message) ? message : null;
}

function scrollTargetIntoView(target, behavior = "smooth") {
  if (!target) {
    return;
  }

  target.scrollIntoView({
    block: "center",
    inline: "nearest",
    behavior
  });
}

function isVisibleScrollTarget(target) {
  if (!target?.isConnected || target.closest(".yacht-hidden-turn")) {
    return false;
  }

  const rect = target.getBoundingClientRect();
  const style = getComputedStyle(target);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden"
  );
}

function isScrollTargetInView(target) {
  if (!isVisibleScrollTarget(target)) {
    return false;
  }

  const rect = target.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const center = rect.top + rect.height / 2;
  return center >= viewportHeight * 0.2 && center <= viewportHeight * 0.8;
}

function clearSourceLinks() {
  const wrappers = [...document.querySelectorAll(".yacht-source-link")];
  for (const wrapper of wrappers) {
    const parent = wrapper.parentNode;
    wrapper.replaceWith(...wrapper.childNodes);
    parent?.normalize();
  }
  state.renderedSourceSignature = "";
}

function hasRenderedSourceLinks(anchors, turns = null) {
  return anchors.every((anchor) => hasRenderedSourceLink(anchor, turns));
}

function hasRenderedSourceLink(anchor, turns = null) {
  const links = [
    ...document.querySelectorAll(
      `.yacht-source-link[data-anchor-id="${CSS.escape(anchor.anchorId)}"]`
    )
  ];
  if (links.length === 0) {
    return false;
  }

  const sourceMessage = findSourceMessage(anchor, turns);
  return !isVisibleSourceMessage(sourceMessage) || links.some(isVisibleElement);
}

function sourceLinkSignature(anchors) {
  const threadPart = state.data.threads
    .map((thread) => `${thread.threadId}:${thread.anchorId}:${thread.updatedAt ?? ""}`)
    .sort()
    .join(",");

  const anchorPart = anchors
    .map((anchor) =>
      [
        anchor.anchorId,
        anchor.sourceMessageKey,
        anchor.sourceMessageId,
        anchor.selectedText,
        anchor.startOffset,
        anchor.endOffset,
        anchor.sourceHash
      ].join(":")
    )
    .join("|");

  return `${threadPart}||${anchorPart}`;
}

function findSourceMessage(anchor, turns = null) {
  if (anchor.sourceMessageId) {
    const byId = [...document.querySelectorAll(
      `[data-message-id="${CSS.escape(anchor.sourceMessageId)}"]`
    )];
    if (byId.length > 0) {
      return byId.find(isVisibleSourceMessage) ?? byId[0];
    }
  }

  return (
    (turns ?? readTurnInfos()).find((info) => info.key === anchor.sourceMessageKey)?.message ??
    null
  );
}

function isVisibleSourceMessage(message) {
  return isVisibleElement(message) && !message.closest(".yacht-hidden-turn");
}

function restoreAnchorRange(anchor, turns = null) {
  const message = findSourceMessage(anchor, turns);
  if (!message) {
    return null;
  }

  const fullText = textFromNodes(message);
  const selected = normalizeText(anchor.selectedText);
  const startOffset = Number(anchor.startOffset);
  const endOffset = Number(anchor.endOffset);

  if (
    Number.isFinite(startOffset) &&
    Number.isFinite(endOffset) &&
    startOffset >= 0 &&
    endOffset <= fullText.length &&
    normalizeText(fullText.slice(startOffset, endOffset)) === selected
  ) {
    return {
      message,
      startOffset,
      endOffset,
      confidence: 1
    };
  }

  const candidate = findRangeByTextContext(fullText, anchor);
  if (candidate.confidence >= 0.7) {
    return {
      message,
      ...candidate
    };
  }

  return null;
}

function findRangeByTextContext(fullText, anchor) {
  const selected = normalizeText(anchor.selectedText ?? "");
  const normalizedFullText = normalizeWithRawMap(fullText);
  const matches = [];
  let index = normalizedFullText.normalized.indexOf(selected);

  while (index >= 0) {
    matches.push(index);
    index = normalizedFullText.normalized.indexOf(selected, index + Math.max(1, selected.length));
  }

  if (matches.length === 0) {
    return { confidence: 0 };
  }

  let best = null;
  const normalizedPrefix = normalizeText(anchor.prefixText ?? "");
  const normalizedSuffix = normalizeText(anchor.suffixText ?? "");
  const expectedStartOffset = Number(anchor.startOffset);

  for (const normalizedStartOffset of matches) {
    const normalizedEndOffset = normalizedStartOffset + selected.length;
    const startOffset = normalizedFullText.startMap[normalizedStartOffset];
    const endOffset = normalizedFullText.endMap[normalizedEndOffset - 1];

    if (!Number.isFinite(startOffset) || !Number.isFinite(endOffset)) {
      continue;
    }

    let score = 0.45;

    if (matches.length === 1) {
      score += 0.2;
    }

    if (Number.isFinite(expectedStartOffset) && Math.abs(startOffset - expectedStartOffset) <= 48) {
      score += 0.2;
    }

    const prefix = normalizedFullText.normalized.slice(
      Math.max(0, normalizedStartOffset - Math.max(50, normalizedPrefix.length)),
      normalizedStartOffset
    );
    const suffix = normalizedFullText.normalized.slice(
      normalizedEndOffset,
      normalizedEndOffset + Math.max(50, normalizedSuffix.length)
    );

    if (normalizedPrefix && prefix.endsWith(normalizedPrefix.slice(-20))) {
      score += 0.18;
    }

    if (normalizedSuffix && suffix.startsWith(normalizedSuffix.slice(0, 20))) {
      score += 0.18;
    }

    if (!best || score > best.confidence) {
      best = { startOffset, endOffset, confidence: score };
    }
  }

  return best ?? { confidence: 0 };
}

function rangeFromTextOffsets(root, startOffset, endOffset) {
  const nodes = textNodesUnder(root);
  let seen = 0;
  let startNode = null;
  let startInNode = 0;
  let endNode = null;
  let endInNode = 0;

  for (const node of nodes) {
    const next = seen + node.nodeValue.length;

    if (!startNode && startOffset >= seen && startOffset <= next) {
      startNode = node;
      startInNode = startOffset - seen;
    }

    if (!endNode && endOffset >= seen && endOffset <= next) {
      endNode = node;
      endInNode = endOffset - seen;
      break;
    }

    seen = next;
  }

  if (!startNode || !endNode) {
    return null;
  }

  const range = document.createRange();
  range.setStart(startNode, startInNode);
  range.setEnd(endNode, endInNode);
  return range;
}

function findAnchorAtPoint(clientX, clientY) {
  if (!state.settings.enabled || state.failSafe) {
    return null;
  }

  for (const link of document.querySelectorAll(".yacht-source-link")) {
    if (pointInsideRects(clientX, clientY, link.getClientRects(), 3)) {
      return findAnchor(link.dataset.anchorId);
    }
  }

  for (const anchor of anchorsWithThreads()) {
    const restored = restoreAnchorRange(anchor);
    if (!restored) {
      continue;
    }

    const range = rangeFromTextOffsets(
      restored.message,
      restored.startOffset,
      restored.endOffset
    );

    if (range && pointInsideRects(clientX, clientY, range.getClientRects(), 3)) {
      return anchor;
    }
  }

  return null;
}

function pointInsideRects(clientX, clientY, rects, padding = 0) {
  return [...rects].some(
    (rect) =>
      clientX >= rect.left - padding &&
      clientX <= rect.right + padding &&
      clientY >= rect.top - padding &&
      clientY <= rect.bottom + padding
  );
}

function wrapTextOffsets(root, startOffset, endOffset, anchor) {
  const range = rangeFromTextOffsets(root, startOffset, endOffset);
  if (!range || range.collapsed) {
    return false;
  }

  if (!rangeTouchesTable(range) && wrapRangeAsSingleSourceLink(range, anchor)) {
    return true;
  }

  return wrapTextOffsetsByTextNode(root, startOffset, endOffset, anchor);
}

function rangeTouchesTable(range) {
  return Boolean(
    nodeElement(range.commonAncestorContainer)?.closest("table, thead, tbody, tfoot, tr, td, th")
  );
}

function wrapRangeAsSingleSourceLink(range, anchor) {
  if (!isSingleSourceLinkRangeSafe(range)) {
    return false;
  }

  try {
    const link = createSourceLink(anchor);
    const contents = range.extractContents();
    link.append(contents);
    range.insertNode(link);
    link.normalize();
    return true;
  } catch (error) {
    console.debug("[Yacht] falling back to segmented source link", anchor.anchorId, error);
    return false;
  }
}

function isSingleSourceLinkRangeSafe(range) {
  const fragment = range.cloneContents();

  if (
    fragment.querySelector(UNSAFE_SOURCE_LINK_SELECTOR)
  ) {
    return false;
  }

  return !fragment.querySelector(BLOCK_SOURCE_LINK_SELECTOR);
}

function createSourceLink(anchor) {
  const link = document.createElement("a");
  link.href = "#";
  link.className = "yacht-source-link";
  link.dataset.anchorId = anchor.anchorId;
  link.dataset.yachtUnderline = String(Boolean(state.settings.sourceLinkStyle.underline));
  link.title = "Open Ask ChatGPT subthread";
  link.setAttribute("role", "link");
  return link;
}

function wrapTextOffsetsByTextNode(root, startOffset, endOffset, anchor) {
  const nodes = textNodesUnder(root);
  let seen = 0;
  let wrapped = false;

  for (const node of nodes) {
    const next = seen + node.nodeValue.length;
    const segmentStart = Math.max(startOffset, seen);
    const segmentEnd = Math.min(endOffset, next);

    if (segmentStart < segmentEnd) {
      const range = document.createRange();
      range.setStart(node, segmentStart - seen);
      range.setEnd(node, segmentEnd - seen);

      const link = createSourceLink(anchor);
      link.dataset.yachtSegmented = "true";

      range.surroundContents(link);
      wrapped = true;
    }

    seen = next;

    if (seen >= endOffset) {
      break;
    }
  }

  return wrapped;
}

function applySourceLinks(turns = readTurnInfos()) {
  if (!state.settings.enabled || state.failSafe) {
    clearSourceLinks();
    return;
  }

  const sortedAnchors = anchorsWithThreads()
    .sort((left, right) => {
      const source = String(right.sourceMessageKey).localeCompare(String(left.sourceMessageKey));
      return source || Number(right.startOffset) - Number(left.startOffset);
    });

  if (sortedAnchors.length === 0) {
    clearSourceLinks();
    return;
  }

  const signature = sourceLinkSignature(sortedAnchors);
  if (signature === state.renderedSourceSignature && hasRenderedSourceLinks(sortedAnchors, turns)) {
    return;
  }

  clearSourceLinks();
  let skipped = 0;

  for (const anchor of sortedAnchors) {
    const restored = restoreAnchorRange(anchor, turns);
    if (!restored) {
      skipped += 1;
      continue;
    }

    try {
      wrapTextOffsets(restored.message, restored.startOffset, restored.endOffset, anchor);
    } catch (error) {
      skipped += 1;
      console.warn("[Yacht] failed to render source link", anchor.anchorId, error);
    }
  }

  if (skipped > 0) {
    console.debug(`[Yacht] skipped ${skipped} source link(s) with low restore confidence.`);
  }

  state.renderedSourceSignature = signature;
}

function applyMessageVisibility(turns = readTurnInfos()) {
  if (state.data.threads.length === 0) {
    clearMessageVisibility();
    return;
  }

  const threadKeyMap = buildThreadKeyMap(turns);
  repairThreadMessageMappings(turns, threadKeyMap);
  reconcileSubthreadContinuations(turns);
  const hiddenKeys = new Set(
    [...threadKeyMap.values()].flatMap(({ messageKeys }) => messageKeys)
  );
  const currentThread = findThread(state.currentThreadId);
  const currentKeys = new Set(threadKeyMap.get(currentThread?.threadId)?.messageKeys ?? []);

  for (const info of turns) {
    let hidden = false;

    if (state.settings.enabled && !state.failSafe && state.mode === "main") {
      hidden = hiddenKeys.has(info.key);
    }

    if (state.settings.enabled && !state.failSafe && state.mode === "subthread") {
      hidden = !currentKeys.has(info.key);
    }

    info.turn.classList.toggle("yacht-hidden-turn", hidden);
  }
}

function clearMessageVisibility() {
  document
    .querySelectorAll(".yacht-hidden-turn")
    .forEach((turn) => turn.classList.remove("yacht-hidden-turn"));
}

function removeLegacyComposerOverlay() {
  document.querySelectorAll(".yacht-composer-overlay").forEach((node) => node.remove());
  document.querySelectorAll("[data-yacht-original-position]").forEach((node) => {
    node.style.position = node.dataset.yachtOriginalPosition;
    delete node.dataset.yachtOriginalPosition;
  });
}

function restoreOriginalRendering() {
  clearSourceLinks();
  clearMessageVisibility();
  removeLegacyComposerOverlay();
  closeThreadChooser();
}

function refreshRepliedContentState() {
  const wasActive = state.repliedContentActive;
  state.repliedContentActive = hasActiveRepliedContent();

  if (
    state.repliedContentActive &&
    state.lastSelection &&
    !state.pendingAsk &&
    Date.now() >= state.suppressRepliedContentAskUntil
  ) {
    createPendingAsk("replied-content");
  }

  if (wasActive !== state.repliedContentActive) {
    scheduleRender();
  }
}

function scheduleRender() {
  clearTimeout(state.renderTimer);
  state.renderTimer = setTimeout(render, 90);
}

function scheduleRenderPasses(delays = [0, 180, 650]) {
  for (const delay of delays) {
    window.setTimeout(scheduleRender, delay);
  }
}

function render() {
  state.rendering = true;
  clearTimeout(state.renderingTimer);
  state.mutationObserver?.disconnect();

  try {
    const turns = readTurnInfos();
    probeDom(turns);
    applyStyleSettings();
    mountHeaderControls();
    updateHeaderControls();

    if (!state.settings.enabled || state.failSafe) {
      restoreOriginalRendering();
      return;
    }

    applySourceLinks(turns);
    applyMessageVisibility(turns);
    removeLegacyComposerOverlay();
  } finally {
    observeDom(handleMutation);
    state.renderingTimer = setTimeout(() => {
      state.rendering = false;
    }, 60);
  }
}

function processMutation() {
  const turns = readTurnInfos();
  refreshRepliedContentState();
  reconcilePendingAsk(turns);
  reconcileSubthreadContinuations(turns);
  scheduleRender();
}

function handleMutation() {
  clearTimeout(state.deferredMutationTimer);
  state.deferredMutationTimer = setTimeout(processMutation, state.rendering ? 90 : 60);
}

function observeRouteChanges() {
  clearInterval(state.routeTimer);
  state.routeTimer = setInterval(async () => {
    const nextConversationId = getConversationId();
    if (nextConversationId === state.conversationId) {
      return;
    }

    state.conversationId = nextConversationId;
    state.pendingAsk = null;
    state.lastSelection = null;
    state.subthreadKnownTurnKeys = null;
    state.subthreadContinuationArmedUntil = 0;
    await loadConversationData();
    await loadNavigationState();
    scheduleRender();
  }, 1000);
}

function handleStorageChange(changes, areaName) {
  if (areaName !== "local" || !changes[SETTINGS_KEY]) {
    return;
  }

  const wasEnabled = state.settings.enabled;
  state.settings = mergeSettings(changes[SETTINGS_KEY].newValue);

  if (!state.settings.enabled) {
    state.pendingAsk = null;
    state.lastSelection = null;
    scheduleRenderPasses([0, 180]);
    return;
  }

  if (!wasEnabled && state.settings.enabled) {
    loadConversationData()
      .then(loadNavigationState)
      .catch((error) => console.error("[Yacht] failed to refresh after enable", error))
      .finally(scheduleRenderPasses);
    return;
  }

  scheduleRenderPasses([0, 180]);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "YACHT_PING") {
    sendResponse({
      ok: true,
      pageTitle: document.title,
      location: window.location.href,
      conversationId: state.conversationId,
      enabled: state.settings.enabled,
      mode: state.mode,
      anchors: state.data.anchors.length,
      threads: state.data.threads.length,
      failSafe: state.failSafe,
      diagnostic: state.diagnostic
    });
    return false;
  }

  if (message?.type === "YACHT_REFRESH_FROM_STORAGE") {
    loadSettings()
      .then(loadConversationData)
      .then(loadNavigationState)
      .then(() => {
        scheduleRenderPasses();
        sendResponse({ ok: true });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

export async function initialize() {
  if (state.initialized) {
    return;
  }

  state.initialized = true;

  try {
    await loadSettings();
    await loadConversationData();
    await loadNavigationState();
  } catch (error) {
    console.error("[Yacht] initialization failed", error);
    setDiagnostic("YACHT could not initialize local extension storage.");
  }

  registerDocumentEvents({
    captureSelection,
    handleDocumentInput,
    handleDocumentKeyDown,
    handleDocumentPointerDown,
    handleDocumentClick
  });
  chrome.storage.onChanged.addListener(handleStorageChange);

  observeDom(handleMutation);
  observeRouteChanges();
  refreshRepliedContentState();
  render();
}
