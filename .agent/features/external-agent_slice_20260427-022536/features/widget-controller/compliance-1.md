# Compliance iteration 1 — F07 widget-controller

## Acceptance criteria

- AC1: PASS — `widgetController.ts:80-95` constructor takes `{runId, threadId, slots, registry, findHandle}`. No React imports. Tested in pure Node via `widgetController.test.ts`.
- AC2: PASS — `project()` builds a fresh object from snapshot fields; "two viewModel() calls in same state are structurally equal" asserts `toEqual`.
- AC3: PASS — `onSend` calls `handle.applyReadyAction({type:'send',…})`, `onCancel` calls `handle.applyReadyAction({type:'cancel'})` from ready or `handle.cancel()` otherwise. `onAnswerClarification` calls `resumeClarify`. Edit budget guard owned by F03 driver.
- AC4: PASS — `findHandle(runId)` returns null → `buildReloadErrorVm()` runs (`widgetController.ts:217-238`); tested.
- AC5: PASS — `dispose()` unsubscribes + clears listeners; "after dispose, no further state changes are pushed to listeners" asserts no growth in listener call count after dispose + later state change.
- AC6: PASS — `onSetTimeout`, `onSetBudget`, `onSelectAdapter` validate before mutating draft; out-of-range value sets `validationError`. Tested for all three.

## Scope coverage

- In scope `widgetController.ts`: PASS.
- In scope `WidgetViewModel`: PASS.
- In scope `Subscription mechanism`: PASS — `subscribe(listener)` returns unsubscribe.
- In scope `Vitest suite`: PASS — 8 cases covering each AC.

## Out-of-scope audit

- Out of scope `React component`: CLEAN — no JSX in this slice.
- Out of scope `Persistence into messageStore (F12)`: CLEAN.
- Out of scope `Settings adapter list (F11)`: CLEAN — controller reads via injected registry.

## QA aggregate

PASS (typecheck + lint + tests + build all green; +8 tests). Integration gate: orchestrator's `findHandle` reachable via `src/main.ts:541` (`this.externalAgentOrchestrator`). Widget controller is library-style; F08 instantiates per-runId from the React mount.

## Verdict: PASS
