import { SELECTORS } from "./constants.js";
import { state } from "./state.js";

export function observationRoots() {
  const roots = [
    document.querySelector("main"),
    document.querySelector(SELECTORS.header),
    document.querySelector(SELECTORS.composerContainer)
  ].filter(Boolean);
  return [...new Set(roots.length > 0 ? roots : [document.body ?? document.documentElement])];
}

export function observeDom(handleMutation) {
  if (!state.mutationObserver) {
    state.mutationObserver = new MutationObserver(handleMutation);
  }

  state.mutationObserver.disconnect();
  const roots = observationRoots();
  for (const root of roots) {
    state.mutationObserver.observe(root, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }
  if (document.body && !roots.includes(document.body)) {
    state.mutationObserver.observe(document.body, { childList: true });
  }
}
