# YACHT Testing Guide

## 1. Testing Overview

Use this guide to validate YACHT after code, manifest, popup, storage, or ChatGPT DOM integration changes.

The extension is a Manifest V3 Chrome extension that injects content code on `https://chatgpt.com/*`, runs a background service worker, and exposes a popup at `src/popup/popup.html`. Testing should cover three layers:

- Static validation of manifest references and extension structure.
- JavaScript syntax checks for files changed in the extension.
- Browser smoke testing and manual checks against ChatGPT.

Run automated checks first, then complete the manual smoke checklist for any change that affects content behavior, popup settings, storage, imports/exports, or DOM selectors.

## 2. Static Validation

Run the existing validation command:

```sh
npm run validate
```

This command is defined in `package.json` and runs:

```sh
node scripts/validate-extension.mjs
```

The `scripts/validate-extension.mjs` script checks that:

- `manifest_version` is `3`.
- `manifest.name` is present.
- `manifest.version` is present.
- Files referenced by the manifest exist, including the popup, service worker, content scripts, content CSS, and generated extension icons.
- `manifest.icons` and `action.default_icon` define the expected 16, 32, 48, and 128 pixel icon paths.

Use this check after editing `manifest.json`, moving files, renaming files, or changing popup/content/background entries.

Also use this check after regenerating icon assets from `logo.png` or changing files under `src/icons/`.

## 3. JavaScript Syntax Checks

There is no npm script for JavaScript syntax checking unless one is added to `package.json`.

Use direct Node commands for syntax checks. For example:

```sh
node --check src/content/content.js
node --check src/content/app.js
node --check src/background/service-worker.js
node --check src/popup/popup.js
node --check scripts/validate-extension.mjs
node --check scripts/smoke-extension.mjs
```

`node --check` is a direct Node command, not an npm script in this repository.

Run syntax checks for every JavaScript file changed in the patch. Also run them for nearby imported modules when changing shared content logic.

## 4. Smoke Script

The repository includes an automated smoke script:

```sh
node scripts/smoke-extension.mjs
```

This is a direct Node command. It is not exposed as an npm script in the current `package.json`.

The smoke script loads the unpacked extension into Chrome, opens `https://chatgpt.com/`, replaces the page body with a controlled fixture, and validates core behavior through the Chrome DevTools Protocol.

The script currently checks:

- Unpacked extension loading.
- Header control placement.
- Selection-driven Ask ChatGPT mapping.
- Immediate Subthread Mode entry after the Ask user turn appears, before the assistant answer is required.
- Subthread Mode hiding and return behavior.
- Source link rendering and click behavior.
- Multiple subthreads for one source link.
- Nested subthread back navigation.
- Extension service worker availability.
- Popup rendering.
- Popup source link color and underline settings.
- Page, popup, and service worker console/runtime errors.

Run headless mode with:

```sh
YACHT_HEADLESS=1 node scripts/smoke-extension.mjs
```

The script supports `CHROME_BIN` to choose a Chrome executable:

```sh
CHROME_BIN=/path/to/chrome YACHT_HEADLESS=1 node scripts/smoke-extension.mjs
```

The smoke script may depend on local Chrome availability and DevTools pipe support. If Chrome is missing, installed in a different location, or built without the required DevTools pipe/extension debugging support, the script can fail before it reaches extension behavior.

## 5. Manual Smoke Checklist

Use this checklist after automated checks pass, especially when touching content scripts, popup code, storage, selectors, or ChatGPT interaction behavior.

- Load the unpacked extension from the repository root in Chrome at `chrome://extensions`.
- Confirm the extension loads without manifest errors.
- Confirm the extension toolbar and Chrome extension-management screens show the YACHT logo instead of Chrome's default placeholder.
- Open `https://chatgpt.com/`.
- Confirm YACHT header controls appear beside the ChatGPT header controls.
- Select text inside an assistant response.
- Trigger the native Ask ChatGPT flow from the selection UI.
- Confirm the new user question is associated with the selected assistant text.
- Confirm Subthread Mode activates as soon as the new user question appears, even before the assistant response appears.
- Confirm unrelated turns are hidden while the subthread remains visible.
- In a subthread that is not at the latest conversation tail, send a follow-up and confirm auto context attaches the last assistant answer before sending.
- Click the return-to-source/header back control.
- Confirm the original source turn becomes visible again.
- Confirm the generated source link appears around the selected text.
- Confirm drag-selecting the source link text can start and finish without opening the subthread.
- Confirm drag-selecting from outside a source link and releasing inside it does not open the subthread.
- Click the source link.
- Confirm it opens the related subthread.
- If one source link has multiple related subthreads, confirm the chooser appears and opens the selected thread.
- If different source links overlap, click the overlapped text and confirm the chooser includes subthreads for every overlapping anchor.
- Turn the extension off from the popup.
- Confirm extension off mode disables YACHT behavior on the ChatGPT page.
- Open the popup and verify settings render correctly.
- Change popup settings and confirm visible source link styling updates on the ChatGPT page.
- Export data from the popup.
- Import previously exported data.
- Confirm imported source links/settings are restored.
- Reset extension data.
- Confirm source links/subthread state/settings are cleared or returned to defaults as expected.

## 6. Testing ChatGPT DOM Changes

ChatGPT DOM changes are the highest-risk area because YACHT depends on page structure, selectors, and event behavior outside this repository.

When ChatGPT changes its markup, validate:

- The content script still loads on `https://chatgpt.com/*`.
- Header controls still attach to the real ChatGPT header, not message-level controls.
- Controls remain aligned when ChatGPT shows or hides its own Share/options buttons.
- Assistant messages are still detected as source messages.
- User messages and assistant replies are still grouped into turns correctly.
- Text selection across inline elements still maps to the correct source text.
- Source links do not break the surrounding ChatGPT message layout.
- Return-to-source behavior restores the expected main thread view.
- Existing saved data still maps to visible turns when possible.

If the smoke script passes but manual ChatGPT testing fails, capture the real page DOM details. The smoke script uses a controlled fixture, so it cannot cover every production ChatGPT markup change.

## 7. Testing Popup Features

Open the extension popup from Chrome's toolbar and verify:

- The popup title is `YACHT Settings`.
- Extension on/off control works.
- Source link color changes are saved.
- Source link underline changes are saved.
- Preview styling matches the selected settings.
- Export, import, and reset controls are visible.
- Changing settings updates an open ChatGPT tab without requiring a full browser restart.

After changing popup settings, reload ChatGPT and confirm settings persist.

## 8. Testing Import/Export/Reset

For export:

- Create at least one source link through the Ask ChatGPT flow.
- Change at least one popup setting.
- Export the data from the popup.
- Confirm a file is downloaded or export output is produced by the browser.

For import:

- Start from a fresh or reset state.
- Import a previously exported YACHT data file.
- Reload ChatGPT.
- Confirm source links, subthread mappings, and settings are restored.

For reset:

- Create source links and change settings first.
- Run reset from the popup.
- Reload ChatGPT.
- Confirm saved source links and subthread mappings are removed.
- Confirm settings return to their expected defaults.

Record whether failures affect only current-page state, persisted storage, or both.

## 9. Known Environment Issues

Automated browser smoke testing depends on the local machine:

- `scripts/smoke-extension.mjs` defaults to `/usr/bin/google-chrome-stable`.
- Use `CHROME_BIN=/path/to/chrome` if Chrome is installed elsewhere.
- Use `YACHT_HEADLESS=1` for headless execution.
- Chrome must support DevTools pipe usage for the initial unpacked extension load.
- Chrome must allow the extension debugging APIs used by the script.
- Network or ChatGPT availability can affect the initial page open, although the script injects its own DOM fixture after navigation.
- Browser profile, permission, or sandbox restrictions can prevent Chrome from launching in some CI or container environments.

When an environment failure occurs, separate it from extension failures. A Chrome launch or DevTools connection failure usually points to local setup. A failed assertion after the fixture loads usually points to extension behavior.

## 10. What to Report When a Test Fails

Include the following in failure reports:

- The command or manual step that failed.
- The exact error output or assertion message.
- Whether the failure came from `npm run validate`, `node --check`, `node scripts/smoke-extension.mjs`, or manual testing.
- Chrome version and operating system.
- Whether `YACHT_HEADLESS=1` was used.
- Whether `CHROME_BIN` was set, and the path used.
- The changed files in the patch.
- Screenshots or screen recording for manual UI failures.
- Console errors from the ChatGPT page, popup, or service worker.
- Export/import file used, if the failure involves data restore.
- Steps to reproduce from a clean browser profile when possible.

For ChatGPT DOM failures, also report the affected visible area, the missing or changed control, and whether the issue reproduces after reloading the page.
