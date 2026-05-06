# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows the version
declared in `manifest.json`.

## [Unreleased]

### Added

- Added this changelog to track future project changes.
- Added generated Chrome extension icon assets from `logo.png` and wired them into the extension manifest.

### Fixed

- Kept rendered source-link text selectable for additional Ask ChatGPT follow-ups by distinguishing drag selection from direct source-link clicks and disabling native link dragging.
- Fixed source navigation so drag gestures that start outside a source link and end inside it do not open a subthread, and overlapping anchors show one chooser with every related subthread.
- Restored auto context attachment by fixing composer-scoped replied-content detection, dispatching pointerup as well as mouseup for synthetic answer selections, and recognizing native Ask controls rendered as button-like roles.
- Fixed new Ask subthread creation so the view enters Subthread Mode as soon as the matching user turn appears, with support for Ask menuitems and button-like replied-content references.

## [0.1.0]

### Added

- Established the Chrome Manifest V3 extension baseline for ChatGPT.
- Added the ChatGPT content script entry point and injected UI styling.
- Added source anchors and wiki-style source links for selected ChatGPT text.
- Added Ask subthread tracking for native Ask ChatGPT questions and answers.
- Added Main Mode and Subthread Mode navigation behavior.
- Added source return links and controls for moving back to the original source.
- Added popup settings for extension behavior and source link styling.
- Added local import, export, and reset controls for stored extension data.
- Added fail-safe diagnostics for ChatGPT DOM recognition issues.

### Changed

- Split content script behavior into focused modules for app coordination,
  constants, diagnostics, DOM readers, events, observers, persistence,
  selection, state, thread modeling, and utilities.
