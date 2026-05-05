export const SETTINGS_KEY = "yacht.settings";
export const NAV_KEY_PREFIX = "yacht.nav.";
export const SCHEMA_VERSION = 1;
export const HEADER_MOUNT_DELAY_MS = 2500;
export const POST_RENDER_SCROLL_DELAYS_MS = [140];//[140, 280, 520, 900];
export const SUBTHREAD_CONTINUATION_ARM_MS = 5 * 60 * 1000;
export const AUTO_CONTEXT_SUPPRESS_MS = 10000;
export const AUTO_CONTEXT_WAIT_MS = 1600;
export const PENDING_ASK_TIMEOUT_MS = 10 * 60 * 1000;
export const UNMATCHED_USER_TURN_GRACE_MS = 1500;

export const SELECTORS = {
  header: "header#page-header",
  headerActions: "#conversation-header-actions",
  headerActionsFallback: '[data-testid="thread-header-right-actions"]',
  shareButton: '[data-testid="share-chat-button"]',
  optionsButton:
    '[data-testid="conversation-options-button"][aria-label="Open conversation options"]',
  turn: 'section[data-testid^="conversation-turn-"][data-turn]',
  message: "[data-message-author-role]",
  assistantMessage: '[data-message-author-role="assistant"]',
  userReferenceButton:
    '[data-message-author-role="user"] button:has(p.line-clamp-3)',
  repliedContent: 'button[aria-label="More about replied content"]',
  removeRepliedContent: 'button[aria-label="Remove"]',
  composerContainer: "#thread-bottom-container, #thread-bottom",
  sendButton: 'button[data-testid="send-button"], button[aria-label="Send prompt"]'
};

export const TEXT_NODE_IGNORE_SELECTOR =
  "script, style, textarea, button, .yacht-header-controls, .yacht-popover, .yacht-diagnostic";
export const TEXT_BLOCK_SELECTOR = "p, li, blockquote, pre, code, h1, h2, h3, h4, h5, h6, td, th";
export const AUTO_CONTEXT_IGNORE_SELECTOR =
  "button, [role='button'], [aria-label='Sources'], [aria-label='More about replied content'], [data-testid='copy-turn-action-button'], [data-testid='conversation-turn-actions'], .yacht-header-controls, .yacht-popover, .yacht-diagnostic";
export const UNSAFE_SOURCE_LINK_SELECTOR =
  "a, button, input, textarea, select, summary, [contenteditable='true'], .yacht-header-controls, .yacht-popover, .yacht-diagnostic";
export const BLOCK_SOURCE_LINK_SELECTOR =
  "address, article, aside, blockquote, caption, col, colgroup, details, dialog, div, dl, fieldset, figcaption, figure, footer, form, h1, h2, h3, h4, h5, h6, header, hr, li, main, nav, ol, p, pre, section, table, tbody, td, tfoot, th, thead, tr, ul";

export const DEFAULT_SETTINGS = {
  schemaVersion: SCHEMA_VERSION,
  enabled: true,
  sourceLinkStyle: {
    color: "#111111",
    underline: true
  }
};
