import { SELECTORS } from "./constants.js";
import { readTurnInfos } from "./dom-readers.js";
import { state } from "./state.js";
import { isChatGptConversationUrl } from "./utils.js";

export function setDiagnostic(message) {
  state.diagnostic = message;

  let diagnostic = document.querySelector(".yacht-diagnostic");
  if (!message) {
    diagnostic?.remove();
    return;
  }

  if (!diagnostic) {
    diagnostic = document.createElement("div");
    diagnostic.className = "yacht-diagnostic";
    diagnostic.setAttribute("role", "status");
    document.documentElement.append(diagnostic);
  }

  diagnostic.textContent = message;
}

export function probeDom(turns = readTurnInfos()) {
  const hasConversationMessages = Boolean(document.querySelector(SELECTORS.message));
  const hasTurns = turns.length > 0;

  if (state.settings.enabled && isChatGptConversationUrl() && hasConversationMessages && !hasTurns) {
    state.failSafe = true;
    setDiagnostic(
      "YACHT is in fail-safe mode because the ChatGPT message DOM was not recognized."
    );
    return;
  }

  state.failSafe = false;
  setDiagnostic("");
}
