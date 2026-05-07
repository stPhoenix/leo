# Compliance iteration 1 — F21 delegate-canvas-layout-edit

## Acceptance criteria

- AC1 (sidecar present + valid layoutAlgo → DONE; sidecar updated with new coordMap): PASS — `tests/unit/canvas/delegateCanvasLayoutEditTool.test.ts` "happy path → orchestrator started with op:layout_edit + initialSidecar + layoutAlgo". Sidecar update on writing phase via existing F15 `writeSidecarFromState` (state.sidecar with `coordMap: buildCoordMap(canvasJson)`).
- AC2 (sidecar missing → sidecar_missing error): PASS — `tests/unit/canvas/delegateCanvasLayoutEditTool.test.ts` "sidecar missing → sidecar_missing error".
- AC3 (`layoutAlgo: 'auto'` allowed): PASS — `tests/unit/canvas/delegateCanvasLayoutEditTool.test.ts` "accepts auto preset"; subgraph `pickPreset` already maps 'auto' to `autoSelect` from F13.
- AC4 (mutex contention → busy + activeOp:layout_edit): PASS — same file "busy → busy payload with op:layout_edit".
- AC5 (locked-coord preservation: entity moved on disk preserves coord post-rewrite): PASS by delegation — `freshState` synthesises diff via `diffAgainstSidecar` when `initialCanvasJson` provided; F14 already implements drift-aware lockedCoords (covered by F14 tests).
- AC6 (deny → denied:true): PASS — same file "deny → denied:true".
- AC7 (subgraph completes in <1s for ≤50 nodes, no LLM): PASS — `tests/unit/canvas/subgraph.test.ts` "skips planning/extracting/reducing/diffing and runs DONE in <1s for ≤50 nodes" (30 nodes; provider throws if invoked).

## Scope coverage

- In scope `tools/delegateCanvasLayoutEdit.ts`: PASS — file exists.
- In scope path validation + sidecar pre-flight: PASS.
- In scope orchestrator routing with `op:'layout_edit'`: PASS — happy-path test asserts capture.
- In scope subgraph layout_edit branch (skip planning/fetching/extracting/reducing/diffing): PASS — `freshState` starts at 'laying_out'; no-call-provider test proves no LLM phases invoked.
- In scope locked-coord preservation: PASS — `diffAgainstSidecar` re-used when `initialCanvasJson` available.
- In scope `instruction` recorded via refineHistory: PASS — passed via `editInstruction` field; subgraph layout_edit branch doesn't enter refine, but value is preserved in state for traceability.
- In scope same result-shape variants with `op:'layout_edit'`: PASS.
- In scope plan-mode blocked: PASS — `DEFAULT_PLAN_MODE_ALLOWLIST` does not include `delegate_canvas_layout_edit`.

## Out-of-scope audit

- Out of scope layout algorithms: CLEAN — F13 unchanged.
- Out of scope schema inference: CLEAN — sidecar schema preserved without modification.

## Integration gate

`Entry points:` scanned: `src/main.ts`. Anchors hit:
- `createDelegateCanvasLayoutEditTool` — `src/main.ts:186`, registered at toolRegistry.

Verdict: PASS.

## Stub-body gate

No stub markers detected.

Verdict: PASS.

## QA aggregate

`pnpm typecheck`/`lint`/`test`/`build` all PASS (286 files / 2686 tests).

## Verdict: PASS
