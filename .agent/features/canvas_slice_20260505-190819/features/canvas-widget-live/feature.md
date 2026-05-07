# F17 · canvas-widget-live — Live widget + view models + controller

## Purpose

Inline assistant block that surfaces the current canvas-run state per phase. `CanvasWidgetController` exposes `viewModel()` + `subscribe(cb)` (`useSyncExternalStore`-friendly) plus action handlers (`onSelectProvider`, `onSelectModel`, `onSelectPreset`, `onSetPath`, `onConfirm`, `onCancel`, `onAnswerClarification`, `onApprove`, `onEdit`, `onSetEditInstruction`). `CanvasLiveBlock` is registered under `CANVAS_LIVE_KIND`; renderer looks up the controller via `canvasLiveControllerRegistry` keyed by `runId`. Mirrors `WikiWidget` / `WikiLiveBlock`.

Covers [FR-CANVAS-38](../../context.md#functional-requirements) (Open preview button), [FR-CANVAS-39](../../context.md#functional-requirements), [FR-CANVAS-59](../../context.md#functional-requirements), [FR-CANVAS-60](../../context.md#functional-requirements).

## Scope

**In scope**

- `src/agent/canvas/widget/widgetState.ts` — `CanvasViewModel` + `CanvasConfigDraft` + `CanvasModelsState` + `CanvasPhase` re-export + helper `isTerminalCanvasPhase`.
- `src/agent/canvas/widget/widgetController.ts` — controller class wrapping `CanvasState` + UI-only draft state (provider/model/preset/path picker), driving the orchestrator's `RunHandle`. Per-phase view-model projection. `useSyncExternalStore`-style `subscribe`.
- `src/agent/canvas/liveControllerRegistry.ts` — `Map<runId, CanvasWidgetController>` plus `CANVAS_LIVE_KIND` constant.
- `src/ui/chat/blocks/CanvasLiveBlock.tsx` — registered renderer; looks up controller by `runId`.
- `src/ui/chat/blocks/CanvasWidget.tsx` — phase-dispatched panel: AWAITING_CONFIG (provider/model/preset/path picker + Start/Cancel), PREPARING (refining transcript + clarification input), PLANNING/FETCHING (per-source progress), EXTRACTING (per-source progress), REDUCING (insights peek), DIFFING (kept/added/removed/locked counts), LAYING_OUT (preset name + progress), PREVIEWING (preview link via `reveal_in_canvas` + Approve/Edit/Cancel), WRITING (write progress).
- 1Hz elapsed-timer overlay during running phases (mirrors wiki widget).
- `CanvasWidget.stories.tsx` Storybook fixtures.

**Out of scope**

- Terminal block + snapshot — F18.
- Slash-command status widget — F22.

## Acceptance criteria

1. Mounting `CanvasLiveBlock` with a registered controller renders the AWAITING_CONFIG panel — traces to FR-CANVAS-59, FR-CANVAS-60.
2. Approve / Edit / Cancel buttons during PREVIEWING route to controller methods which call orchestrator's resume/cancel — traces to FR-CANVAS-39.
3. Open-preview button calls `reveal_in_canvas({ path: previewPath })` via tool dispatch — traces to FR-CANVAS-38.
4. Provider/model/preset/path picker writes draft state; Start triggers orchestrator's `start()` after Zod-validating the path (`.canvas` extension + traversal-safe) — traces to FR-CANVAS-60.
5. Each phase has at least one Storybook variant (`AWAITING_CONFIG idle`, `PREPARING refining`, `PREPARING clarifying`, `PLANNING fetching-progress`, `EXTRACTING progress`, `REDUCING insights-peek`, `DIFFING summary`, `LAYING_OUT progress`, `PREVIEWING approve-edit-cancel`, `WRITING progress`).
6. Edit instruction draft text is not lost on re-render (state persists in controller, not local component state).
7. The widget unmounts cleanly and the controller's terminal cleanup runs `liveControllerRegistry.delete(runId)`.

## Dependencies

- [../canvas-subgraph/feature.md](../canvas-subgraph/feature.md) — controller wraps `RunHandle`.
- Forward consumers: [../canvas-widget-terminal/feature.md](../canvas-widget-terminal/feature.md), [../delegate-canvas-create/feature.md](../delegate-canvas-create/feature.md), [../delegate-canvas-content-edit/feature.md](../delegate-canvas-content-edit/feature.md), [../delegate-canvas-layout-edit/feature.md](../delegate-canvas-layout-edit/feature.md), [../canvas-slash-commands/feature.md](../canvas-slash-commands/feature.md).
- Requirements traced: [../../context.md#functional-requirements](../../context.md#functional-requirements) FR-CANVAS-38, FR-CANVAS-39, FR-CANVAS-59, FR-CANVAS-60.

## Implementation notes

- [../../../../architecture/architecture.md#3-modules](../../../../architecture/architecture.md#3-modules) — UI layer above agent layer; renderer registry pattern (`liveControllerRegistry`).
- [../../../../architecture/architecture.md#6-state-ownership](../../../../architecture/architecture.md#6-state-ownership) — controller owns view-model; state lives in subgraph.
- [../../../../standards/code-style.md#react-18](../../../../standards/code-style.md#react-18) — function components only; `useSyncExternalStore`; stable `key`s; cleanup in `useEffect`.
- [../../../../standards/code-style.md#styling-tailwind--obsidian](../../../../standards/code-style.md#styling-tailwind--obsidian) — Tailwind utilities + Obsidian CSS vars; scope to plugin root.
- [../../../../standards/tech-stack.md#ui-layer](../../../../standards/tech-stack.md#ui-layer) — Lucide icons, Assistant UI markdown for chat content, Obsidian renderer for note previews (preview link uses native).

## Open questions

- Should the AWAITING_CONFIG panel pre-fill `targetPath` from refine's proposed `outputPath` when present, even before the user clicks Start? Yes — pre-fill, leave field editable.
- Should the WRITING phase show a spinner or a progress bar? Spinner only — atomic rename is sub-second; progress bar would be misleading.
