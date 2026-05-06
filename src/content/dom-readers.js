import { SELECTORS } from "./constants.js";
import { hashString, normalizeText, shortTitle } from "./utils.js";

const USER_REFERENCE_CONTROL_SELECTOR = ':is(button, [role="button"]):has(p.line-clamp-3)';

export function readTurnInfos() {
  return [...document.querySelectorAll(SELECTORS.turn)]
    .map((turn, index) => {
      const message =
        turn.querySelector("[data-message-author-role][data-message-id]") ??
        turn.querySelector(SELECTORS.message);
      const role =
        message?.getAttribute("data-message-author-role") ??
        turn.getAttribute("data-turn") ??
        "unknown";

      if (!message) {
        return null;
      }

      return {
        turn,
        message,
        role,
        index,
        key: getMessageKey(message, role, index)
      };
    })
    .filter(Boolean);
}

export function getMessageKey(message, role = "unknown", index = 0) {
  const messageId = message.getAttribute("data-message-id");

  if (messageId) {
    return `message:${messageId}`;
  }

  const text = normalizeText(message.textContent ?? "").slice(0, 160);
  return `fallback:${role}:${index}:${hashString(text)}`;
}

export function findMessageByKey(messageKey, turns = null) {
  if (typeof messageKey !== "string") {
    return null;
  }

  if (messageKey.startsWith("message:")) {
    const messageId = messageKey.slice("message:".length);
    return document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
  }

  return (turns ?? readTurnInfos()).find((info) => info.key === messageKey)?.message ?? null;
}

export function findTurnInfoForMessageKey(messageKey, turns = readTurnInfos()) {
  const direct = turns.find((info) => info.key === messageKey);
  if (direct) {
    return direct;
  }

  const message = findMessageByKey(messageKey, turns);
  const turn = message?.closest?.(SELECTORS.turn);
  if (!turn) {
    return null;
  }

  return turns.find((info) => info.turn === turn) ?? null;
}

export function getUserQuestionText(message) {
  const clone = message.cloneNode(true);
  clone
    .querySelectorAll(`${USER_REFERENCE_CONTROL_SELECTOR}, .yacht-source-link`)
    .forEach((node) => node.remove());
  return shortTitle(clone.textContent ?? "Ask ChatGPT follow-up");
}

export function getUserReferenceTexts(message) {
  return [...message.querySelectorAll(USER_REFERENCE_CONTROL_SELECTOR)]
    .map((control) =>
      normalizeText(control.querySelector("p.line-clamp-3")?.textContent ?? control.textContent ?? "")
    )
    .filter(Boolean);
}

export function normalizeAskReferenceText(text = "") {
  return normalizeText(text)
    .replace(/^[\s↪↩↳⤷←→↑↓›»>:\-–—]+/u, "")
    .replace(/\\([*_`~[\]()#>])/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~#]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function isAskUserTurnForAnchor(turnInfo, anchor) {
  if (turnInfo?.role !== "user" || !anchor) {
    return false;
  }

  const selectedText = normalizeAskReferenceText(anchor.selectedText ?? "");
  if (!selectedText) {
    return false;
  }

  return getUserReferenceTexts(turnInfo.message).some((referenceText) => {
    const normalizedReference = normalizeAskReferenceText(referenceText);
    return (
      normalizedReference.length >= 2 &&
      (selectedText.includes(normalizedReference) || normalizedReference.includes(selectedText))
    );
  });
}
