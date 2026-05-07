# F19 · delegate-canvas-create — `delegate_canvas_create` tool

## Purpose

Register the `delegate_canvas_create({ ask, targetPath?, layoutAlgo? })` tool with `requiresConfirmation: true`. On confirm, mounts a live widget, calls `CanvasOrchestrator.start({ op: 'create', ... })`, and shapes the resulting tool result per SRS §8.4 (`ok: true` with insights, `ok: false` with denied / cancelled / busy / error variants).

Covers [FR-CANVAS-01](../../context.md#functional-requirements), [FR-CANVAS-05](../../context.md#functional-requirements), [FR-CANVAS-44](../../context.md#functional-requirements) (tool-result shape), [FR-CANVAS-47](../../context.md#functional-requirements) (busy result).

## Scope

**In scope**

- `src/agent/canvas/tools/delegateCanvasCreate.ts` — tool definition with Zod input `{ ask: string (1..16384), targetPath?: string (validated via F01), layoutAlgo?: PresetId }`.
- `requiresConfirmation: true` routed via existing `confirmationController` with action `Prepare canvas create` / `Deny`. Deny → `{ ok: false, denied: true }` per FR-CANVAS-05.
- Plan-mode policy: blocked in plan mode (write tool).
- Result shaper:
  - DONE → `{ ok: true, runId, path, insights, partial?, durationMs }`.
  - CANCELLED → `{ ok: false, cancelled: true, phase, partial }`.
  - busy → `{ ok: false, error: 'busy', activeRunId, activeOp }` (returned without mounting widget).
  - ERROR → `{ ok: false, error: { code, message }, partial? }`.
- Tool result wrapper: `{ ok: true, data: <CanvasToolResult> }` so structured payload survives downstream serializer (mirrors `delegateExternal.ts` precedent).

**Out of scope**

- Subgraph FSM — F16.
- Widget rendering — F17.
- Content-edit / layout-edit tools — F20 / F21.

## Acceptance criteria

1. Confirmation accepted → orchestrator started with `op: 'create'`; tool resolves with `ok: true` on DONE — traces to FR-CANVAS-01, FR-CANVAS-05.
2. Confirmation denied → `{ ok: false, denied: true }`; orchestrator never started — traces to FR-CANVAS-05.
3. Mutex contention against the same `targetPath` (or refine-resolved path) → `{ ok: false, error: 'busy', activeRunId, activeOp }`; widget not mounted — traces to FR-CANVAS-47.
4. `targetPath` provided but invalid (`..`, non-`.canvas`) → tool fails Zod parse before confirmation — traces to NFR-CANVAS-12.
5. Tool result includes `insights: { hubs, components, orphans, perTypeCount }` for DONE — traces to FR-CANVAS-44.
6. Tool registered with `requiresConfirmation: true`; verified by registry test — traces to FR-CANVAS-01.
7. Plan-mode allowlist test confirms `delegate_canvas_create` is **not** allowed in plan mode (blocked).

## Dependencies

- [../canvas-subgraph/feature.md](../canvas-subgraph/feature.md), [../canvas-widget-live/feature.md](../canvas-widget-live/feature.md), [../canvas-mutex/feature.md](../canvas-mutex/feature.md) (busy detection).
- Existing reuse: `confirmationController`.
- Forward consumers: [../delegate-canvas-content-edit/feature.md](../delegate-canvas-content-edit/feature.md) (parallel pattern), [../delegate-canvas-layout-edit/feature.md](../delegate-canvas-layout-edit/feature.md), [../canvas-slash-commands/feature.md](../canvas-slash-commands/feature.md).
- Requirements traced: [../../context.md#functional-requirements](../../context.md#functional-requirements) FR-CANVAS-01, FR-CANVAS-05, FR-CANVAS-44, FR-CANVAS-47.

## Implementation notes

- [../../../../architecture/architecture.md#4-key-contracts](../../../../architecture/architecture.md#4-key-contracts) — `ToolResult` shape `{ ok, ... }`.
- [../../../../architecture/architecture.md#3-modules](../../../../architecture/architecture.md#3-modules) — tool placement under `src/agent/canvas/tools/`.
- [../../../../standards/code-style.md#langgraph--agent-layer](../../../../standards/code-style.md#langgraph--agent-layer) — `requiresConfirmation` set explicitly; tool result shape mandatory.
- [../../../../standards/code-style.md#zod--tool-schemas](../../../../standards/code-style.md#zod--tool-schemas) — `.describe()` on every input field; LLM reads it.

## Open questions

- For `delegate_canvas_create` the mutex key is the resolved `targetPath` — but `targetPath` may be derived by refine (FR-CANVAS-10). When does mutex acquire happen? Decision: acquire **after** refine emits its `RunPlan` (i.e., enter PLANNING) — before that, multiple concurrent `create` calls without explicit `targetPath` are tolerated.
