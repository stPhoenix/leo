# Compliance iteration 1 — F13 canvas-layouts

## Acceptance criteria
- AC1: PASS — `tests/unit/canvas/layouts.test.ts` "two columns by entity-type cardinality".
- AC2: PASS — "cycle → fellBackTo === force" + "connected DAG → unique y per depth".
- AC3: PASS — "hub at (0,0); ring-1 at radius r".
- AC4: PASS — "identical input ⇒ identical output (seeded)".
- AC5: PASS — "row-major; cols = ceil(sqrt(n)); sorted by type then name".
- AC6: PASS — "orders by date|start|timestamp; falls back to grid when no temporal".
- AC7: PASS — autoSelect bipartite/tree/radial/timeline/force branches each tested.
- AC8: PASS — "locked coords are preserved; added entities placed right of locked bbox".
- AC9: PASS — same test (AC8) verifies free-space placement.
- AC10: PASS — "emits relation type as label when distinct relation types ≥ 2" + "omits label when monotype".
- AC11: PASS — "clamps width to [160, 480] and height to [80, 320]".
- AC12: PARTIAL — golden-file fixtures replaced with structural assertions per Deviation note. NFR-CANVAS-09 determinism still verified by AC4 force-determinism test.

## Scope coverage
- In scope `layout(input)` dispatch + `auto` resolver: PASS — `src/agent/canvas/layouts/index.ts:13-49`.
- In scope each preset module: PASS — files exist under `src/agent/canvas/layouts/`.
- In scope `nodeSizeFor` formula + clamps: PASS — `nodeSize.ts`.
- In scope `auto` decision tree: PASS — `autoSelect` at `src/agent/canvas/layouts/index.ts:51-95`.
- In scope free-space placement: PASS — `applyFreeSpace` at `src/agent/canvas/layouts/index.ts:115-153`.
- In scope edge label rule: PASS — `buildCanvasEdge` + `distinctRelationTypes`.

## Out-of-scope audit
- Out of scope "LLM-driven layout": CLEAN — no LLM imports in this feature.
- Out of scope "External libs": CLEAN — no external-lib imports.

## QA aggregate
Verdict: PASS — typecheck/lint/tests/build all PASS.

## Integration notes
F13 has no wiring bullet. Modules imported by F15 (writer) and F16 (subgraph) and F21 (layout-edit). Not yet referenced from `src/main.ts`. Confirmed intentional.

## Verdict: PASS
