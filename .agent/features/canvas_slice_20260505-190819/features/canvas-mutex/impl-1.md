# Impl iteration 1 — F06 canvas-mutex

## Summary
Added `src/agent/canvas/mutex.ts` exporting `CanvasMutex` (per-vault-path single-active-op gate) with `acquire(path, runId, op)`, `active(path)`, `activeAll()` (alphabetical snapshot for `/canvas-status`), and idempotent `release`. Distinct paths gate independently. Mutex emits `canvas.<op>.mutex.{acquire,release,busy}` debug logs via `CANVAS_LOG`.

## Files touched
- `src/agent/canvas/mutex.ts` — `CanvasMutex` class + types + `CanvasOp` literal union
- `tests/unit/canvas/mutex.test.ts` — 6 unit tests

## Tests added or updated
- `tests/unit/canvas/mutex.test.ts` covers AC1 (busy on overlap), AC2 (distinct paths parallel), AC3 (release frees), AC4 (idempotent release does not delete unrelated holder), AC5 (`active`), AC6 (`activeAll` alphabetical).

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
- `WikiMutex` returns `{ ok:false, error:'busy', activeRunId, activeOp }` flat — feature.md F06 specifies `{ ok:false, busy: { activeRunId, activeOp } }` nested. Followed feature.md (nested) so downstream tool result shape matches `FR-CANVAS-47` exactly: `{ ok: false, error: 'busy', activeRunId, activeOp }` will be assembled by F19/F20/F21 from the `busy` field.

## Assumptions
- `CanvasOp` union typed `'create' | 'content_edit' | 'layout_edit'` (kebab-cased per feature.md tool ids).
- `mutex.busy` log emitted in the requested-op's namespace so contention telemetry is grouped per attempting op (not per holder op) — easier to alert on a specific delegate call's contention pattern.

## Open questions
None — log-on-acquire/release per feature.md open-question resolution.
