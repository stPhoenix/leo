# F20 · delegate-canvas-content-edit — `delegate_canvas_content_edit` tool

## Purpose

Register `delegate_canvas_content_edit({ path, instruction, layoutAlgo? })` with `requiresConfirmation: true`. On confirm, loads the sidecar via [F07](../canvas-sidecar/feature.md) (errors `sidecar_missing` if absent), parses the current `.canvas` JSON via [F14](../canvas-diff/feature.md) (errors `canvas_parse_failed` if corrupt), threads the tombstone summary into refine context, then runs the full pipeline including DIFFING. Result shape mirrors F19 with `op: 'content_edit'`.

Covers [FR-CANVAS-02](../../context.md#functional-requirements), [FR-CANVAS-05](../../context.md#functional-requirements), [FR-CANVAS-25](../../context.md#functional-requirements) (error routing), [FR-CANVAS-26](../../context.md#functional-requirements) (refine tombstone routing), [FR-CANVAS-44](../../context.md#functional-requirements) (tool-result shape), [FR-CANVAS-47](../../context.md#functional-requirements) (busy result).

## Scope

**In scope**

- `src/agent/canvas/tools/delegateCanvasContentEdit.ts` — Zod input `{ path: string, instruction: string (1..16384), layoutAlgo?: PresetId }`. `requiresConfirmation: true`.
- Pre-flight (before confirmation):
  - Validate `path` via F01 (`.canvas` extension, traversal-safe).
- Pre-flight (after confirmation, before subgraph start):
  - Load sidecar via F07 → if `null`: return `{ ok: false, error: { code: 'sidecar_missing', message: ... } }`.
  - `tryParseCurrentCanvas` via F14 → if `Err('canvas_parse_failed')`: return `{ ok: false, error: { code: 'canvas_parse_failed', message: ... } }`.
- On success route to `CanvasOrchestrator.start({ op: 'content_edit', sidecar, currentCanvasJson, instruction, ... })`.
- Tombstone summary built via F14 helper, threaded into refine via subgraph deps (FR-CANVAS-26).
- Same result-shape variants as F19; `op` field set to `'content_edit'` in busy returns.
- Plan-mode: blocked.

**Out of scope**

- Diff algorithm — F14.
- Subgraph FSM — F16.
- Tool registration plumbing replicated across F19/F20/F21 — extract a small shared helper if natural.

## Acceptance criteria

1. Confirmation accepted with valid sidecar + parseable canvas → orchestrator started with `op: 'content_edit'`; DONE result shape per FR-CANVAS-44 — traces to FR-CANVAS-02, FR-CANVAS-05.
2. Sidecar missing → `{ ok: false, error: { code: 'sidecar_missing' } }`; orchestrator never started — traces to FR-CANVAS-02.
3. Current canvas unparseable → `{ ok: false, error: { code: 'canvas_parse_failed' } }` — traces to FR-CANVAS-25.
4. Refine sub-agent receives tombstone summary string (verified via spy) when sidecar has tombstones — traces to FR-CANVAS-26.
5. Refined plan re-asks for tombstoned name → tombstone cleared before DIFFING — traces to FR-CANVAS-26 (delegated to F14 helper).
6. Mutex contention against the same `path` → `{ ok: false, error: 'busy', activeRunId, activeOp: 'content_edit' }` — traces to FR-CANVAS-47.
7. Confirmation denied → `{ ok: false, denied: true }` — traces to FR-CANVAS-05.
8. Plan-mode allowlist test confirms tool **not** allowed in plan mode.

## Dependencies

- [../delegate-canvas-create/feature.md](../delegate-canvas-create/feature.md) — parallel pattern (extract shared helper `confirmAndRunCanvas` if natural).
- [../canvas-diff/feature.md](../canvas-diff/feature.md) — `tryParseCurrentCanvas`, tombstone summary helper.
- [../canvas-sidecar/feature.md](../canvas-sidecar/feature.md) — `readSidecar`.
- [../canvas-subgraph/feature.md](../canvas-subgraph/feature.md), [../canvas-widget-live/feature.md](../canvas-widget-live/feature.md), [../canvas-mutex/feature.md](../canvas-mutex/feature.md).
- Requirements traced: [../../context.md#functional-requirements](../../context.md#functional-requirements) FR-CANVAS-02, FR-CANVAS-05, FR-CANVAS-25, FR-CANVAS-26, FR-CANVAS-44, FR-CANVAS-47.

## Implementation notes

- [../../../../architecture/architecture.md#4-key-contracts](../../../../architecture/architecture.md#4-key-contracts) — `ToolResult` `{ ok, ... }`.
- [../../../../architecture/architecture.md#3-modules](../../../../architecture/architecture.md#3-modules) — tool placement convention.
- [../../../../standards/code-style.md#error-handling](../../../../standards/code-style.md#error-handling) — fail-fast pre-flight at boundary.
- [../../../../standards/code-style.md#langgraph--agent-layer](../../../../standards/code-style.md#langgraph--agent-layer) — typed result shapes.

## Open questions

- Should the pre-flight sidecar/canvas-parse checks happen before or after the confirmation gate? After confirmation — consistent with `delegateExternal.ts` "user owns confirmation, then we do work". Avoids leaking sidecar-existence info if user denies.
