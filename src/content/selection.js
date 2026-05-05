import { SCHEMA_VERSION } from "./constants.js";
import { getMessageKey, readTurnInfos } from "./dom-readers.js";
import { state } from "./state.js";
import {
  createId,
  hashString,
  nodeElement,
  normalizeText,
  textFromNodes,
  textNodesUnder
} from "./utils.js";

export function captureSelection() {
  if (Date.now() < state.suppressSelectionCaptureUntil) {
    return;
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return;
  }

  const range = selection.getRangeAt(0);
  const startMessage = nodeElement(range.startContainer)?.closest(
    '[data-message-author-role="assistant"]'
  );
  const endMessage = nodeElement(range.endContainer)?.closest(
    '[data-message-author-role="assistant"]'
  );

  if (!startMessage || startMessage !== endMessage) {
    return;
  }

  const selectedText = range.toString();
  if (normalizeText(selectedText).length < 2) {
    return;
  }

  const offsets = offsetsForRange(startMessage, range);
  if (!offsets) {
    return;
  }

  const fullText = textFromNodes(startMessage);
  const turnInfo = readTurnInfos().find((info) => info.message === startMessage);

  state.lastSelection = {
    selectedText: normalizeText(selectedText),
    sourceMessageId: startMessage.getAttribute("data-message-id") ?? null,
    sourceMessageKey:
      turnInfo?.key ?? getMessageKey(startMessage, "assistant", turnInfo?.index ?? 0),
    sourceRole: "assistant",
    startOffset: offsets.start,
    endOffset: offsets.end,
    prefixText: fullText.slice(Math.max(0, offsets.start - 50), offsets.start),
    suffixText: fullText.slice(offsets.end, offsets.end + 50),
    sourceHash: hashString(normalizeText(fullText)),
    capturedAt: new Date().toISOString()
  };
}

export function offsetsForRange(root, range) {
  const nodes = textNodesUnder(root);
  let seen = 0;
  let start = null;
  let end = null;

  for (const node of nodes) {
    const next = seen + node.nodeValue.length;

    if (node === range.startContainer) {
      start = seen + range.startOffset;
    }

    if (node === range.endContainer) {
      end = seen + range.endOffset;
      break;
    }

    seen = next;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    return null;
  }

  return { start, end };
}

export function findExistingAnchor(selection) {
  return (
    state.data.anchors.find((anchor) => {
      const sameMessage = anchor.sourceMessageKey === selection.sourceMessageKey;
      const sameText = normalizeText(anchor.selectedText) === selection.selectedText;
      const closeOffsets =
        Math.abs(Number(anchor.startOffset) - selection.startOffset) <= 2 &&
        Math.abs(Number(anchor.endOffset) - selection.endOffset) <= 2;
      return sameMessage && sameText && closeOffsets;
    }) ?? null
  );
}

export function buildAnchorFromSelection(selection) {
  const existing = findExistingAnchor(selection);

  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    anchorId: createId("anchor"),
    conversationId: state.conversationId,
    sourceMessageKey: selection.sourceMessageKey,
    sourceMessageId: selection.sourceMessageId,
    sourceRole: selection.sourceRole,
    selectedText: selection.selectedText,
    prefixText: selection.prefixText,
    suffixText: selection.suffixText,
    startOffset: selection.startOffset,
    endOffset: selection.endOffset,
    sourceHash: selection.sourceHash,
    createdAt: now,
    updatedAt: now
  };
}
