# F21 · delegate-canvas-layout-edit — `delegate_canvas_layout_edit` tool

## Purpose

Register `delegate_canvas_layout_edit({ path, layoutAlgo, instruction? })` with `requiresConfirmation: true`. Degenerate FSM: skips PLANNING/FETCHING/EXTRACTING/REDUCING/DIFFING; loads the sidecar's `entityGraph` + `coordMap`, applies the chosen preset (with locked-coord preservation for nodes the user did not move), and writes through the standard PREVIEWING → WRITING flow.

Covers [FR-CANVAS-03](../../context.md#functional-requirements), [FR-CANVAS-05](../../context.md#functional-requirements), [FR-CANVAS-44](../../context.md#functional-requirements) (tool-result shape), [FR-CANVAS-47](../../context.md#functional-requirements) (busy result).

## Scope

**In scope**

- `src/agent/canvas/tools/delegateCanvasLayoutEdit.ts` — Zod input `{ path: string, layoutAlgo: PresetId, instruction?: string }`. `requiresConfirmation: true`.
- Pre-flight: validate `path`; load sidecar; error `sidecar_missing` if absent.
- Routes to `CanvasOrchestrator.start({ op: 'layout_edit', sidecar, layoutAlgo, instruction?, ... })`.
- Subgraph (F16) recognizes `op: 'layout_edit'` and skips PLANNING/FETCHING/EXTRACTING/REDUCING/DIFFING — goes directly to LAYING_OUT with sidecar's `entityGraph` + `coordMap` as inputs.
- Locked-coord preservation: kept entities with current canvas drift > `MOVE_DRIFT_PX` retain coords (degenerate diff: re-parse current canvas + compare to sidecar `coordMap`, honor moves).
- `instruction` (when present) is recorded into refine history for traceability but does not invoke refine (no schema inference in this path).
- Same result-shape variants as F19/F20 with `op: 'layout_edit'`.
- Plan-mode: blocked.

**Out of scope**

- Layout algorithms — F13.
- Schema inference — explicitly skipped per SRS §1.2 / §3.1 / §5 degenerate path.

## Acceptance criteria

1. Sidecar present + valid `layoutAlgo` → run completes DONE with re-laid-out canvas; sidecar updated with new `coordMap` — traces to FR-CANVAS-03, FR-CANVAS-05.
2. Sidecar missing → `{ ok: false, error: { code: 'sidecar_missing' } }` — traces to FR-CANVAS-03.
3. `layoutAlgo: 'auto'` allowed; subgraph runs `auto` selection on the sidecar's entityGraph — traces to FR-CANVAS-34.
4. Mutex contention → `{ ok: false, error: 'busy', activeOp: 'layout_edit' }` — traces to FR-CANVAS-47.
5. Locked-coord preservation: entity moved on disk by user → its coord preserved post-rewrite — traces to FR-CANVAS-22 (reused logic).
6. Confirmation denied → `{ ok: false, denied: true }` — traces to FR-CANVAS-05.
7. Subgraph completes in < 1s for graphs ≤ 50 nodes (no LLM calls) — observable expectation; verified with mock provider.

## Dependencies

- [../delegate-canvas-create/feature.md](../delegate-canvas-create/feature.md) — parallel pattern.
- [../canvas-sidecar/feature.md](../canvas-sidecar/feature.md), [../canvas-subgraph/feature.md](../canvas-subgraph/feature.md) (degenerate FSM branch), [../canvas-layouts/feature.md](../canvas-layouts/feature.md), [../canvas-mutex/feature.md](../canvas-mutex/feature.md).
- Requirements traced: [../../context.md#functional-requirements](../../context.md#functional-requirements) FR-CANVAS-03, FR-CANVAS-05, FR-CANVAS-44, FR-CANVAS-47.

## Implementation notes

- [../../../../architecture/architecture.md#5-data-flows](../../../../architecture/architecture.md#5-data-flows) — degenerate FSM branch is documented at the SRS state-machine diagram (§5).
- [../../../../architecture/architecture.md#3-modules](../../../../architecture/architecture.md#3-modules) — tool placement.
- [../../../../standards/code-style.md#langgraph--agent-layer](../../../../standards/code-style.md#langgraph--agent-layer) — typed result shapes; `requiresConfirmation: true`.
- [../../../../standards/best-practices.md#core-principles](../../../../standards/best-practices.md#core-principles) — DRY: degenerate FSM reuses subgraph rather than forking.

## Open questions

- Should `layout_edit` accept `layoutAlgo: 'auto'` and let the subgraph re-pick from sidecar's graph shape, or require an explicit preset? Accept `auto` (most usable from the chat surface).
- Open question §15.5 — "lock all current positions" sub-mode — out of scope; tracked as future work.
