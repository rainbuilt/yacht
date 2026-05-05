import { DEFAULT_SETTINGS, SCHEMA_VERSION, TEXT_NODE_IGNORE_SELECTOR } from "./constants.js";

export function isChatGptConversationUrl() {
  return /^\/c\/[^/?#]+/.test(window.location.pathname);
}

export function getConversationId() {
  const match = window.location.pathname.match(/^\/c\/([^/?#]+)/);
  return match?.[1] ?? `page:${window.location.pathname}`;
}

export function mergeSettings(settings = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    sourceLinkStyle: {
      ...DEFAULT_SETTINGS.sourceLinkStyle,
      ...(settings.sourceLinkStyle ?? {})
    },
    schemaVersion: SCHEMA_VERSION
  };
}

export function normalizeText(text = "") {
  return text.replace(/\s+/g, " ").trim();
}

export function normalizeWithRawMap(text = "") {
  let normalized = "";
  const startMap = [];
  const endMap = [];
  let index = 0;

  while (index < text.length) {
    const char = text[index];

    if (/\s/.test(char)) {
      const whitespaceStart = index;
      while (index < text.length && /\s/.test(text[index])) {
        index += 1;
      }

      if (normalized.length > 0 && index < text.length) {
        normalized += " ";
        startMap.push(whitespaceStart);
        endMap.push(index);
      }
      continue;
    }

    normalized += char;
    startMap.push(index);
    endMap.push(index + 1);
    index += 1;
  }

  return { normalized, startMap, endMap };
}

export function shortTitle(text = "") {
  const normalized = normalizeText(text);
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

export function hashString(input = "") {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createId(prefix) {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${prefix}_${id}`;
}

export function nodeElement(node) {
  return node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement ?? null;
}

export function textNodesUnder(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (
        !node.nodeValue ||
        (!normalizeText(node.nodeValue) && node.parentElement?.closest("table"))
      ) {
        return NodeFilter.FILTER_REJECT;
      }

      const parent = node.parentElement;

      if (parent?.closest(TEXT_NODE_IGNORE_SELECTOR)) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const nodes = [];
  while (walker.nextNode()) {
    nodes.push(walker.currentNode);
  }
  return nodes;
}

export function textFromNodes(root) {
  return textNodesUnder(root)
    .map((node) => node.nodeValue)
    .join("");
}
