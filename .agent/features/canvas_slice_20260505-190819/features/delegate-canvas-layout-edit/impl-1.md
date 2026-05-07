# Impl iteration 1 — F21 delegate-canvas-layout-edit

## Summary

`delegate_canvas_layout_edit({ path, layoutAlgo, instruction? })` registered with `requiresConfirmation: true`. Pre-flight loads sidecar (errors `sidecar_missing` / `sidecar_corrupt`), parses current canvas (best-effort — used only for drift-aware lockedCoords), then routes to orchestrator with `op: 'layout_edit'`. Subgraph branches on `op==='layout_edit'` in `freshState`: starts at `'laying_out'` with sidecar's `entityGraph` as graph, sidecar's `coordMap` as lockedCoords, synthesised diff (kept-only or drift-aware via `diffAgainstSidecar` when `initialCanvasJson` present). Sidecar schema preserved on commit (no runPlan in this path).

## Files

- `src/agent/canvas/tools/delegateCanvasLayoutEdit.ts` — Zod schema `{ path, layoutAlgo (PRESET_IDS|'auto'), instruction? }`; validate-time path check; async `buildStartInput` reads sidecar + best-effort current-canvas parse; passes `initialSidecar` + optional `initialCanvasJson` to orchestrator.
- `src/agent/canvas/subgraph.ts` — added `initialCanvasJson?: CanvasJson | null` to `StartCanvasInput`; `freshState` branches on `op==='layout_edit' && initialSidecar` to start at `'laying_out'` with synthesised diff (real `diffAgainstSidecar` when canvas JSON present, fallback to all-locked when not); writing-phase `schema` falls back to `input.initialSidecar?.schema` when `runPlan` is null.
- `src/main.ts` — register `delegate_canvas_layout_edit` via `toolRegistry.register`.
- `tests/unit/canvas/delegateCanvasLayoutEditTool.test.ts` — 8 tests: id+confirmation, plan-mode exclusion, validate rejects bad path, accepts auto preset, sidecar_missing, happy path with op:layout_edit + sidecar capture, busy:layout_edit, deny.
- `tests/unit/canvas/subgraph.test.ts` — added 1 test: layout_edit skips planning/extracting/reducing/diffing and runs DONE in <1s for 30 nodes via no-call provider (`stream()` throws if invoked).

## Decisions

- **`freshState` branches in subgraph rather than per-phase guards** — simpler and DRY (Framework First). The synthesised diff makes the existing `laying_out` block work without modification.
- **`initialCanvasJson` is optional** — when current canvas exists, we use real diff to produce drift-aware lockedCoords (FR-CANVAS-22). When absent (first relayout after a manual mode switch), all coords lock.
- **Sidecar schema preserved on commit when no runPlan** — layout_edit does not change schema; falls back to `input.initialSidecar.schema` (graceful default to empty arrays if sidecar missing entirely, though pre-flight guarantees sidecar presence).
- **`auto` preset accepted** — per open-question answer in feature.md.
- **`instruction` is logged via `editInstruction` only** — no refine invocation per SRS §1.2 / §3.1 degenerate path.

## Test coverage

8 + 1 = 9 new tests.

## QA local

Typecheck/lint/test/build all green (286 files / 2686 tests; +1 file +9 tests vs F20).
