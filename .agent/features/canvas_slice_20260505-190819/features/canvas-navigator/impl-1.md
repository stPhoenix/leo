# Impl iteration 1 — F02 canvas-navigator

## Summary
Added `src/editor/canvasNavigator.ts` mirroring `WorkspaceNavigator` shape: `CanvasNavigator` interface with `openCanvas` + `panZoomToBbox`, Obsidian-backed factory `createObsidianCanvasNavigator`, runtime feature detection via cast-to-internal `view.canvas.zoomToBbox` probe with structured `CanvasNavigatorWarning` union, per-leaf detection cache (`WeakMap`), and `canvas.reveal.*` debug logging. Added `tests/unit/canvasNavigator.test.ts` with 7 cases — happy path open, leaf reveal, missing TFile, padded bbox math, missing-canvas fallback, missing-zoomToBbox fallback, and never-throws probe.

## Files touched
- `src/editor/canvasNavigator.ts` — new adapter
- `tests/unit/canvasNavigator.test.ts` — new unit tests

## Tests added or updated
- `tests/unit/canvasNavigator.test.ts` covers AC1 (openCanvas opens/reveals), AC2 (padded bbox math via `zoomToBbox`), AC3 (shape-mismatch returns false, no throw), AC4 (probe never throws on weird shapes), AC5 (DOM-style assertions for both happy + fallback).

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
- Probe runs per `panZoomToBbox` call rather than at adapter construction — Obsidian leaf views aren't ready until after `openFile` resolves, and a lazy per-call probe with `WeakMap` cache matches the AC4 "once per leaf, never throws" intent without forcing a separate probe entrypoint.

## Assumptions
- Internal Obsidian canvas API exposes `view.canvas.zoomToBbox({minX,minY,maxX,maxY})` and optional `requestFrame()`. Probe falls back gracefully on shape mismatch.
- `CANVAS_VIEW_TYPE = 'canvas'` constant matches Obsidian's canvas view type — verified by external Obsidian plugin convention; if a future build renames it, the probe will simply find no leaves (openCanvas opens fresh) and panZoom will fall through.

## Open questions
- Open question §15.1 (selectNodeIds) explicitly deferred per feature.md.
