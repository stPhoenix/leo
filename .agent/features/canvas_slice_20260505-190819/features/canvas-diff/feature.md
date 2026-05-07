# F14 · canvas-diff — Diff merge + lock detection

## Purpose

For content-edit runs, classify entities `kept` / `added` / `removed` against the loaded sidecar; for each kept entity compare current `.canvas` JSON coord vs sidecar last-rendered coord and mark `locked: true` when drift > `MOVE_DRIFT_PX`. Diff edges by `(fromId, toId, type)` triple — sidecar edges absent from current canvas become `edgeTombstones`. Build the tombstone summary to feed back into refine for the next iteration. Emit `canvas_parse_failed` when the current `.canvas` JSON is unparseable.

Covers [FR-CANVAS-20](../../context.md#functional-requirements) through [FR-CANVAS-26](../../context.md#functional-requirements).

## Scope

**In scope**

- `src/agent/canvas/diff.ts` exporting `diffAgainstSidecar({ newGraph, sidecar, currentCanvasJson, budgets }) → DiffResult`.
- `DiffResult` shape per SRS §6: `kept: { id; locked }[]`, `added: string[]`, `removed: string[]`, `edgesRemoved: { from; to; type }[]`.
- Locked-coord map extraction: walk current canvas JSON, key by `Entity.id` via match against sidecar's previous `coordMap` keys; coord drift = max(|Δx|, |Δy|) compared to sidecar coord.
- Edge tombstones computed by triple-set difference.
- `buildTombstoneSummary(removed, edgesRemoved) → string` for refine context (FR-CANVAS-26 wording: "user previously removed entities X, Y, Z — do not re-emit unless instruction explicitly requests").
- `tryParseCurrentCanvas(adapter, path) → Result<CanvasJson, 'canvas_parse_failed'>` — used by F20.
- Tombstone clearing helper: when refined plan re-asks for a tombstoned name (heuristic match), drop from tombstones.

**Out of scope**

- Free-space placement of `added` — F13 owns the algorithm; F14 supplies the `addedIds` set.
- Sidecar persistence — F07.
- Refine sub-agent — F08.

## Acceptance criteria

1. Sidecar entity present + same canonical id in new graph → `kept` row — traces to FR-CANVAS-21.
2. New graph entity not in sidecar → `added` row — traces to FR-CANVAS-21.
3. Sidecar entity absent from current canvas JSON → `removed` row → tombstone — traces to FR-CANVAS-21, FR-CANVAS-23.
4. Kept entity with drift `Δx = 20` → `locked: true`; with `Δx = 8` → `locked: false` — traces to FR-CANVAS-22.
5. Drift uses `max(|Δx|, |Δy|) > MOVE_DRIFT_PX` (16); both axes consulted.
6. Edge `(a,b,attended)` in sidecar but missing in current canvas → `edgesRemoved` entry — traces to FR-CANVAS-24.
7. New edges that did not exist in sidecar always re-emit (not tombstoned) — traces to FR-CANVAS-24.
8. Unparseable current canvas → `tryParseCurrentCanvas` returns `Err('canvas_parse_failed')` — traces to FR-CANVAS-25.
9. Tombstone summary string matches SRS-mandated wording (snapshot test) — traces to FR-CANVAS-26.
10. Refined plan re-asking for tombstoned entity name "Alice" → tombstone for Alice cleared (case-insensitive name match) — traces to FR-CANVAS-26.

## Dependencies

- [../canvas-json/feature.md](../canvas-json/feature.md) — `CanvasJson` parser used by `tryParseCurrentCanvas`.
- [../canvas-sidecar/feature.md](../canvas-sidecar/feature.md) — `SidecarV1` shape.
- [../canvas-reducer/feature.md](../canvas-reducer/feature.md) — `EntityGraph` input.
- [../canvas-budgets-runid-slug/feature.md](../canvas-budgets-runid-slug/feature.md) — `MOVE_DRIFT_PX`.
- Forward consumers: [../canvas-subgraph/feature.md](../canvas-subgraph/feature.md), [../delegate-canvas-content-edit/feature.md](../delegate-canvas-content-edit/feature.md).
- Requirements traced: [../../context.md#functional-requirements](../../context.md#functional-requirements) FR-CANVAS-20..26.

## Implementation notes

- [../../../../architecture/architecture.md#5-data-flows](../../../../architecture/architecture.md#5-data-flows) — diff dataflow placement: between REDUCING and LAYING_OUT.
- [../../../../architecture/architecture.md#3-modules](../../../../architecture/architecture.md#3-modules) — pure-domain module; no IO except read-current-canvas helper which goes through `VaultAdapter`.
- [../../../../standards/code-style.md#typescript](../../../../standards/code-style.md#typescript) — `as const` for tombstone wording template.
- [../../../../standards/best-practices.md#core-principles](../../../../standards/best-practices.md#core-principles) — Single Responsibility: diff does set classification + lock detection only; never mutates layout.

## Open questions

- Identifying canvas-JSON nodes by `Entity.id` requires the writer (F15) to embed a stable id-mapping (e.g., node `id` = entity `id` directly). Confirm convention with F15. **Decision: writer uses `entity.id` as canvas node `id` 1:1 (no separate uuid).**
- Heuristic for tombstone-clearing name match — case-insensitive whole-string for v1; revisit if false positives appear.
