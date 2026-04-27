# Impl iteration 1 — F07 widget-controller

## Summary

Built `ExternalAgentWidgetController` — a framework-free per-`runId` controller that subscribes to a `RunHandle`'s state, projects it into a flat `WidgetViewModel` discriminated by `phase`, and routes widget actions back into the subgraph (`onSend`, `onEdit`, `onCancel`, `onSelectAdapter`, `onSetTimeout`, `onSetBudget`, `onAnswerClarification`). Validation guards (timeout 1s–24h, budget 1–10, adapter must be enabled) emit a typed `validationError` field on the view model rather than throwing. Reload rehydration: when the constructor cannot find a live `RunHandle` for the given `runId` (e.g. plugin reload during RUNNING per NFR-EXT-04), the controller starts in `phase='error'` with `error.code='reload'`. Extended `ExternalAgentOrchestrator` to track live handles in a `Map<runId, RunHandle>` cleared on terminal so widget controllers (or persistence rehydrators) can look them up.

## Files touched

- `src/agent/externalAgent/widgetController.ts` — new module: `ExternalAgentWidgetController` + `WidgetViewModel` + `AdapterOption` + numeric range constants.
- `src/agent/externalAgent/orchestrator.ts` — added `liveHandles` map + `findHandle(runId)` lookup, registered on start, cleared on terminal.
- `tests/unit/externalAgent/widgetController.test.ts` — 8 cases: rehydration error, projection determinism, send/cancel routing, three validation rules, dispose cleanliness.
- `tests/unit/externalAgent/delegateExternalTool.test.ts` — narrowed `liveHandle` typing via wrapper object (TS narrowed closure to `never`).

## Tests added or updated

- AC1 — controller takes `{runId, threadId, slots, registry, findHandle}` only; tests construct without React or singletons.
- AC2 — "two viewModel() calls in same state are structurally equal".
- AC3 — onSend/onCancel routing tests; budget non-reset on Edit guarded by F03 driver.
- AC4 — "emits ERROR{code:reload} when no live handle for runId".
- AC5 — "after dispose, no further state changes are pushed to listeners".
- AC6 — three validation tests (timeout below min, budget out of range, adapter not enabled).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- The `WidgetViewModel` is a flat object keyed on `phase` (not a discriminated union per phase) so the React widget (F08) can render a single component with phase-specific visibility. All "draft" fields (adapter id, timeout, budget) live on the controller rather than in the subgraph state until `onSend` commits them — matches AC3 ("mutate draft state until onSend").
- `findHandle(runId)` lookup lives on the orchestrator rather than in `SlotManager`. `SlotManager` only tracks slot occupancy by id; orchestrator additionally caches the `RunHandle` reference for widget rehydration.

## Assumptions

- Per OQ-01-F07: changing adapter mid-PREPARING does not restart refine — selection only commits at send.
- Per OQ-02-F07: validation errors surface via `viewModel.validationError`; cleared on next valid input.

## Open questions

OQ-01/02-F07 honored. No new open questions.
