# F13 · canvas-layouts — Layout presets + auto-select + node-size + free-space

## Purpose

Pure deterministic `layout(graph, preset, lockedCoords, addedIds) → CanvasJson`. Six hand-rolled presets — `bipartite`, `tree`, `radial`, `force`, `grid`, `timeline` — plus an `auto` dispatch that picks one based on graph shape. Locked nodes retain their input coords verbatim; added entities use free-space placement abutting the locked-bbox right edge. Node sizing is content-length-driven. No LLM. No IO. No clock. Verified by golden-file fixtures.

Covers [FR-CANVAS-27](../../context.md#functional-requirements) through [FR-CANVAS-37](../../context.md#functional-requirements), [NFR-CANVAS-09](../../context.md#non-functional-requirements).

## Scope

**In scope**

- `src/agent/canvas/layouts/index.ts` — `layout(graph, preset, lockedCoords, addedIds, budgets)` dispatch + `auto` resolver.
- `src/agent/canvas/layouts/bipartite.ts` — two-column layout per FR-CANVAS-28 (anchors = top-2 entity-type cardinalities; remaining types fall to whichever column they connect to most; vertical-order median heuristic).
- `src/agent/canvas/layouts/tree.ts` — Reingold-Tilford top-down DAG layout; cycle → fall back to `force`.
- `src/agent/canvas/layouts/radial.ts` — top-degree centered, neighbors on concentric rings by hop distance; uniform polar angles per ring.
- `src/agent/canvas/layouts/force.ts` — Fruchterman-Reingold, fixed 200 iterations.
- `src/agent/canvas/layouts/grid.ts` — row-major, `cols = ceil(sqrt(n))`, sorted by entity-type then alpha name.
- `src/agent/canvas/layouts/timeline.ts` — left-to-right by `entity.fields.date | start | timestamp` (first non-null); fall back to `grid` if none.
- `src/agent/canvas/layouts/nodeSize.ts` — `width = clamp(round(text.length × 6), 160, 480)`, `height = clamp(round(lineCount × 24 + 48), 80, 320)`.
- `auto` selection per FR-CANVAS-34: `bipartite` if exactly 2 dominant entity types and 1 dominant relation type; `tree` if relation graph acyclic + connected; `radial` if a single entity has degree > 2× median; `timeline` if any entity has temporal field; `force` otherwise.
- Free-space placement (FR-CANVAS-37): bounding box of locked nodes; row-major grid abutting right edge with `freeSpacePadPx`.
- Edge labels: emit relation `type` when graph has > 1 distinct relation type; omit when monotype (FR-CANVAS-36).

**Out of scope**

- LLM-driven layout — explicitly excluded.
- External libs (`dagre`, `elkjs`, `d3-force`) — out of scope.

## Acceptance criteria

1. `bipartite` on a person-event graph with 2 entity types → 2 columns; columns sized by entity-type cardinality; vertical order minimizes crossings (verified by counting on golden fixture) — traces to FR-CANVAS-28.
2. `tree` on a connected DAG → unique y-per-depth; on a cycle → falls back to `force` and emits a `warn` log — traces to FR-CANVAS-29.
3. `radial` on a hub-and-spoke graph → hub at `(0,0)`; ring-1 at radius `r`; ring-2 at `2r`; angle uniform per ring — traces to FR-CANVAS-30.
4. `force` is deterministic given a seeded init (uses entity-id hash as seed) — same input ⇒ identical output — traces to FR-CANVAS-31, NFR-CANVAS-09.
5. `grid` sorts by entity-type then alpha name; produces row-major coords — traces to FR-CANVAS-32.
6. `timeline` orders by `entity.fields.date | start | timestamp`; missing temporal fields entirely → falls back to `grid` — traces to FR-CANVAS-33.
7. `auto` dispatch matches every branch in the FR-CANVAS-34 decision tree (one fixture per branch).
8. Locked coords passed in are preserved verbatim in output — traces to FR-CANVAS-22 (used by F14).
9. Free-space placement positions added entities right of locked bbox + `freeSpacePadPx`, growing downward in row-major — traces to FR-CANVAS-37.
10. Edge label emitted when distinct-relation-types ≥ 2; omitted when 1 — traces to FR-CANVAS-36.
11. Node sizing matches FR-CANVAS-35 formula with clamps — traces to FR-CANVAS-35.
12. Each preset has a golden-file fixture; snapshot stable across reruns — traces to NFR-CANVAS-09.

## Dependencies

- [../canvas-json/feature.md](../canvas-json/feature.md) — `CanvasJson` output type.
- [../canvas-budgets-runid-slug/feature.md](../canvas-budgets-runid-slug/feature.md) — `MOVE_DRIFT_PX`, `freeSpacePadPx`, node-size override map.
- Forward consumers: [../canvas-writer/feature.md](../canvas-writer/feature.md), [../canvas-subgraph/feature.md](../canvas-subgraph/feature.md), [../delegate-canvas-layout-edit/feature.md](../delegate-canvas-layout-edit/feature.md).
- Requirements traced: [../../context.md#functional-requirements](../../context.md#functional-requirements) FR-CANVAS-27..37; [../../context.md#non-functional-requirements](../../context.md#non-functional-requirements) NFR-CANVAS-09.

## Implementation notes

- [../../../../architecture/architecture.md#3-modules](../../../../architecture/architecture.md#3-modules) — pure-domain module rule (no platform imports).
- [../../../../architecture/architecture.md#1-architectural-principles](../../../../architecture/architecture.md#1-architectural-principles) — determinism + purity.
- [../../../../standards/code-style.md#testing-vitest--msw](../../../../standards/code-style.md#testing-vitest--msw) — golden snapshots only for stable structural output.
- [../../../../standards/best-practices.md#core-principles](../../../../standards/best-practices.md#core-principles) — KISS: hand-rolled algorithms; no external libs (bundle budget).

## Open questions

- `force` determinism via id-hash seed — does it reproduce across Node 20 vs Electron renderer? Verify in DOM test.
- Should auto-select run twice (once before lock, once after, allowing locked geometry to influence preset)? No — pick once before lock so the preset is stable across re-runs (less surprise to user).
- Node-size override map per entity-type is empty in v1; is the API exposed for plugins/skills? Internal only — settings exposure deferred (SRS §10).
