# Impl iteration 1 — F20 delegate-canvas-content-edit

## Summary

`delegate_canvas_content_edit({ path, instruction, layoutAlgo? })` ships with `requiresConfirmation: true`. Pre-flight after confirmation: load sidecar via `readSidecar` (errors `sidecar_missing` if `null`, `sidecar_corrupt` on read/parse fail), parse current `.canvas` via `tryParseCurrentCanvas` (errors `canvas_parse_failed`). On success → orchestrator `start({ op: 'content_edit', initialSidecar, editInstruction, targetPath, layoutAlgo? })`. Tombstones already threaded into refine via `subgraph` from `initialSidecar.tombstones` (logged for visibility). Wrapper / busy / denied / error / cancelled shaping reuses `runCanvasConfirmFlow`.

## Files

- `src/agent/canvas/tools/canvasToolFlow.ts` — shared `runCanvasConfirmFlow({ toolId, orchestrator, confirmation, ctx, args, allowLabel, buildStartInput })` extracted from F19. `buildStartInput` accepts sync or async builder for content/layout edit pre-flight.
- `src/agent/canvas/tools/delegateCanvasCreate.ts` — refactored to use shared helper (no functional change).
- `src/agent/canvas/tools/delegateCanvasContentEdit.ts` — Zod schema `{ path, instruction (1..16384), layoutAlgo? }`; validate-time `validateVaultRelativePath` for `path`; async `buildStartInput` reads sidecar + parses canvas; logs `tombstoneSummary` length.
- `src/main.ts` — register `delegate_canvas_content_edit` via `toolRegistry.register`.
- `tests/unit/canvas/delegateCanvasContentEditTool.test.ts` — 8 tests: id+confirmation, plan-mode exclusion, validate rejects bad path, deny, sidecar_missing, canvas_parse_failed, happy path with `op:'content_edit' + initialSidecar.tombstones` capture, busy.

## Decisions

- **Pre-flight after confirmation** — per feature.md open-question answer: avoids leaking sidecar-existence on deny.
- **Tombstone threading is delegated to F16 subgraph** — subgraph already pulls `tombstones`/`edgeTombstones` from `initialSidecar`. Tool only logs summary length for diagnostics.
- **Shared `runCanvasConfirmFlow`** — eliminates F19/F20/F21 boilerplate; sync/async `buildStartInput` covers both create (sync) and edit variants (async).
- **`sidecar_corrupt` error code** — separate from `sidecar_missing` for diagnostic clarity (file exists but unreadable/invalid).

## Test coverage

8 tests for content-edit tool; F19's 7 still pass (refactor regression-free).

## QA local

Typecheck/lint/test/build all green (285 files / 2677 tests; +1 file +8 tests vs F19).
