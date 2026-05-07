# Impl iteration 1 — F17 canvas-widget-live

## Summary

`CanvasWidgetController` mirrors `WikiWidgetController` shape — `viewModel()` + `subscribe()` (`useSyncExternalStore`-friendly) plus `setPhase / update / startConfigPhase / onSelectProvider/Model/Preset / onSetPath / onConfirm / onCancel / onRetryLoadModels / answerClarification / approve / edit / cancel / openPreview / setEditInstruction`. `CanvasLiveBlock` registered under `CANVAS_LIVE_KIND='canvas_live'`; rehydrate path produces synthetic controller in `error.code='reload'`.

## Files

- `src/agent/canvas/widget/widgetState.ts` — `CanvasViewModel`, `CanvasConfigDraft` (incl. preset + path), `CanvasModelsState`, `RefineTurn`, `ProgressCounts`, `DiffSummary`, `TERMINAL_CANVAS_PHASES`, `makeInitialCanvasViewModel`, `isTerminalCanvasPhase`. Re-exports `CanvasPhase` from `state.ts`.
- `src/agent/canvas/widget/widgetController.ts` — controller class. Picker resolves `CanvasConfigOverride { providerId, model, preset, path }`. `validateVaultRelativePath` gates Confirm. Edit instruction stored on view-model so it survives re-render. `dispose()` aborts model load + resolves pending picker promise with `null`.
- `src/agent/canvas/liveControllerRegistry.ts` — `Map<runId, CanvasWidgetControllerLike>` plus `CANVAS_LIVE_KIND` + `CanvasLiveProps` shape.
- `src/ui/chat/blocks/CanvasLiveBlock.tsx` — registered renderer; instanceof guard for live controller, fallback to `reloadRehydrate`.
- `src/ui/chat/blocks/CanvasWidget.tsx` — phase-dispatched. Phases: AWAITING_CONFIG (provider/model/preset/path picker + Start/Cancel), PREPARING (refine transcript + clarification form), PLANNING/FETCHING (progress counts), EXTRACTING (progress + failed count), REDUCING (insights peek), DIFFING (kept/added/removed/locked summary + tombstones), LAYING_OUT (preset + fellBackTo), PREVIEWING (Open preview button + Approve/Edit/Cancel + edit instruction textarea), WRITING (status line), DONE/CANCELLED (terminal summary), ERROR (header-only). 1Hz elapsed timer overlay during running phases.
- `src/ui/chat/blocks/CanvasWidget.stories.tsx` — Storybook fixtures: AwaitingConfigIdle, PreparingRefining, PreparingClarifying, FetchingProgress, ExtractingProgress, ReducingInsights, DiffingSummary, LayingOutProgress, PreviewingApproveEditCancel, WritingProgress, TerminalDone.
- `tests/unit/canvas/widgetController.test.ts` — 7 tests: initial vm, subscribe, startConfigPhase confirm, invalid path rejection, approve/edit/cancel forwarding, reloadRehydrate error.code='reload', dispose-resolves-null.
- `tests/unit/canvas/liveControllerRegistry.test.ts` — 4 tests: kind constant, register/lookup/release roundtrip, release-unknown no-op, dispose failure isolation.

## Decisions

- **Edit instruction in view-model, not React state** — survives re-render per AC #6. Mirrors approach in WikiWidget for finding notes.
- **`CanvasConfigOverride` extends `ProviderOverride` shape** — adds `preset` + `path` since canvas needs both at start.
- **`PhaseBody` switch returns `null` for `error`** — header-only; error message rendered by parent `CanvasWidgetView` (matches WikiWidget).

## Test coverage

11 tests (7 controller + 4 registry). Component DOM tests deferred to Storybook fixtures per AC #5.

## QA local

Typecheck/lint/test/build all green (279 files / 2644 tests; +2 files +11 tests vs F16).
