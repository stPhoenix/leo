# Impl iteration 1 — F14 canvas-diff

## Summary
Added `src/agent/canvas/diff.ts` exporting `diffAgainstSidecar`, `tryParseCurrentCanvas`, `buildTombstoneSummary`, and `clearTombstonesByName`. Diff classifies entities `kept`/`added`/`removed` against sidecar `coordMap` keys; for kept entities, drift = `max(|Δx|, |Δy|) > MOVE_DRIFT_PX` flips `locked: true` and pushes the current coord into `lockedCoords` (consumed by F13 `layout(lockedCoords)`). Edge tombstones via `(from, to, type)` triple-set difference (with wildcard label match for canvases that don't carry `label`). Tombstone summary uses the SRS-mandated wording template. `clearTombstonesByName` heuristic: case-insensitive substring match of entity name against the stringified RunPlan; matches drop the tombstone.

## Files touched
- `src/agent/canvas/diff.ts` — diff + lock detection + tombstone helpers
- `tests/unit/canvas/diff.test.ts` — 14 unit tests
- `tests/unit/canvas/__snapshots__/diff.test.ts.snap` — generated snapshot

## Tests added or updated
- `tests/unit/canvas/diff.test.ts` covers AC1 (kept), AC2 (added), AC3 (removed), AC4 (lock by Δx=20 vs 8), AC5 (max-axis lock), AC6 (edge removed), AC7 (new edges not tombstoned), AC8 (`canvas_parse_failed`), AC9 (snapshot of summary wording), AC10 (case-insensitive tombstone clear).

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
- The wildcard label check for current-canvas edges accepts edges in the canvas JSON without explicit `label` (which F15 may omit when monotype). The triple-set difference uses both the explicit `label`-keyed key and a wildcard `*` key.
- `clearTombstonesByName` heuristic uses substring match of entity name against the stringified RunPlan rather than parsing the plan structurally — RunPlan doesn't carry per-entity names, only types/source hints/scope filter. Substring on the JSON-stringified plan is a conservative match that catches names appearing in `scope.filter` or any future plan-level prose. False positives can be tightened in v2.

## Assumptions
- Writer (F15) emits canvas node `id = entity.id` 1:1 (per feature.md open-question decision). `diffAgainstSidecar` keys by node id.
- Edge label on canvas edges may be absent (monotype graphs). Diff treats absent label as wildcard match for the same `(from, to)` pair.

## Open questions
- Tombstone-clearing false positives — heuristic is intentionally permissive in v1.
