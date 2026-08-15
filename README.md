# MG-SeedDeleterMod

> **Disclaimer:** This mod is extracted from [ARIE's mod](https://github.com/Ariedam64/MG-AriesMod) and modified by Josh.

MG-SeedDeleterMod is a browser userscript (Tampermonkey/Greasemonkey) written in TypeScript that adds a bulk seed-deletion tool to the browser-based gardening game *Magic Garden*. It injects a small floating toggle button that expands into a control panel, letting the player select one or more seed species and quantities, then delete them in bulk instead of one by one through the game's own inventory UI.

Under the hood it hooks the page's `WebSocket` to find the game's live connection and issues the game's own `Wish` action (the same call the game uses to sacrifice/delete an item) once per unit being deleted.

## Features

- Floating toggle button + panel, both draggable (click vs. drag is distinguished by movement threshold, so dragging never also opens/closes the panel).
- Toggle button position and open/closed panel position are remembered across page reloads (stored in `localStorage` as a relative fraction of the viewport, so resizing the window keeps them anchored and on-screen).
- Toggle button can be switched between **draggable** (default corner placement, movable) and **fixed** (pinned at a fixed `left`/`bottom` offset, not draggable) from a checkbox in the panel.
- Seed selection overlay (opened via "Select seeds") to pick species and quantities from the current inventory, opens centered on screen.
- Pause / resume / stop controls and a live progress + ETA readout while a bulk deletion is running.

## Supported sites

The userscript only runs on pages matching (see `meta.userscript.js`):

- `https://1227719606223765687.discordsays.com/*`
- `https://magiccircle.gg/r/*`
- `https://magicgarden.gg/r/*`
- `https://starweaver.org/r/*`

## Installing the userscript

1. Install a userscript manager in your browser (e.g. [Tampermonkey](https://www.tampermonkey.net/)).
2. Build the project (see below) to produce `dist/seed-deleter.min.user.js` — `dist/` is not committed to the repo, so this step is required.
3. Open `dist/seed-deleter.min.user.js` in your browser (or drag it into the browser window); Tampermonkey will prompt to install it.
4. Visit one of the supported sites above — the toggle button should appear in the bottom-right corner of the page.

## Development

Requires Node.js (with npm).

```bash
npm install     # install dependencies
npm run build   # one-off production build -> dist/seed-deleter.min.user.js
npm run watch   # rebuild on every change -> dist/seed-deleter.dev.user.js (inline sourcemaps)
npm run serve   # serve dist/ at http://localhost:5175 (CORS enabled)
```

The build is a single esbuild bundle (see `esbuild.config.mjs`) with `src/main.ts` as its entry point; the resulting bundle is prefixed with the userscript metadata block from `meta.userscript.js` and written to `dist/`.

While developing, run `npm run watch` and reinstall/reload `dist/seed-deleter.dev.user.js` in your userscript manager after each change (or point the userscript manager at `npm run serve`'s URL, if your manager supports remote updates).

## Project structure

```
meta.userscript.js      Userscript metadata block (@name, @match, @grant, ...), prepended to the build output
esbuild.config.mjs      Build script (esbuild bundle + metadata prepend, prod and --watch modes)
src/
  main.ts               Entry point: installs the WebSocket hook and mounts the UI
  core/                 Low-level state (captured sockets/workers), WS payload parsing, sendToGame()
  hooks/wsHook.ts       Wraps the page's WebSocket constructor to capture the game's live connection
  data/                 Static plant catalog (seed display name -> species mapping)
  services/             Bulk seed deletion pipeline, fake inventory/modal helpers used to read selections from the game's own UI
  store/                Bindings into the game's own state (atoms/hub/bridge/jotai) used to read inventory and selection
  ui/                   Floating toggle button, panel, and toast notifications
  utils/page-context.ts Access to the real page `window` vs. the userscript's sandboxed window
```
