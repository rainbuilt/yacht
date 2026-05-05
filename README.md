# YACHT

YACHT is a Chrome extension that helps organize follow-up questions inside ChatGPT conversations. It lets a user select part of an assistant answer, ask a follow-up from that source text, and later jump between the original source and the follow-up thread.

YACHT is a Chrome Manifest V3 extension for `https://chatgpt.com/*`.

## Core Ideas

- **Source Anchor**: the saved source selection in an assistant message. It records where a follow-up came from.
- **Source Link**: the visible link YACHT renders back onto the ChatGPT page for a saved Source Anchor. Clicking it opens the related follow-up thread.
- **Main Mode**: the normal conversation view. YACHT shows the main conversation and renders Source Links for saved anchors.
- **Subthread Mode**: a focused view for one follow-up thread. YACHT hides unrelated turns, shows the thread rooted at the selected source, and provides a way back to the source.
- **Ask Subthread**: the follow-up created from ChatGPT's native Ask/replied-content flow after the user selects source text. YACHT records the selected source as an anchor and tracks the resulting question and answer as a subthread.

## Runtime Entry Point

Chrome injects `src/content/content.js` on matching ChatGPT pages. That file is intentionally small: it resolves the extension URL for `src/content/app.js`, dynamically imports it, and calls `initialize()`.

The main content-script implementation lives in `src/content/app.js`. Its initialization loads settings, conversation data, and navigation state, then registers document events, storage listeners, DOM observers, route observers, and the first render pass.

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this repository folder.
5. Open or refresh `https://chatgpt.com`.

After editing extension files, reload YACHT from `chrome://extensions` and refresh any open ChatGPT tabs.

## Validation

Run the local validation check:

```bash
npm run validate
```

## Maintainer Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Content Script Modules](docs/CONTENT_SCRIPT_MODULES.md)
- [ChatGPT DOM](docs/CHATGPT_DOM.md)
- [Testing](docs/TESTING.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Data Model](docs/DATA_MODEL.md)
- [Runtime Flows](docs/FLOWS.md)
- [Development](docs/DEVELOPMENT.md)
- [Release Checklist](docs/RELEASE_CHECKLIST.md)
- [Decisions](docs/DECISIONS.md)
