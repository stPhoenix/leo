# F07 — Widget controller (subgraph ↔ widget bridge)

## Purpose

Bridge layer between the subgraph (Agent layer) and the widget React component (UI layer). Projects `ExternalAgentState` into a small, stable widget store; routes widget actions (Send, Edit, Cancel, change adapter, change timeout, change refine budget, answer clarifying question) back into the subgraph. Owns reload-rehydration semantics so an in-flight RUNNING subgraph that is interrupted by plugin reload surfaces as `ERROR { code: 'reload' }`.

Implements [`context.md`](../../context.md) NFR-EXT-04 and provides the data binding the widget UI (F08) consumes.

## Scope

**In scope**
- `src/agent/externalAgent/widgetController.ts`: pure controller class `ExternalAgentWidgetController` per `runId`. Owns:
  - subscription to subgraph state events;
  - projection function `state → WidgetViewModel`;
  - action handlers (`onSend`, `onEdit`, `onCancel`, `onSelectAdapter`, `onSetTimeout`, `onSetBudget`, `onAnswerClarification`);
  - rehydration probe at construction: if no live subgraph for the persisted `runId`, immediately surface `ERROR { code: 'reload' }`.
- `WidgetViewModel` shape: a discriminated union keyed on `phase`, carrying only the fields the UI needs (no full state — keeps render diff cheap).
- Subscription mechanism: lightweight observer (matches existing `runStateStore` pattern in `src/chat/runStateStore.ts`) — no new state library.
- Vitest suite (no React) covering: action routing, projection determinism per phase, rehydration probe both with and without a live subgraph.

**Out of scope**
- React component itself (F08).
- Persistence into `messageStore` (F12).
- Settings-side adapter list (F11) — controller reads it via injected accessor.

## Acceptance criteria

1. `ExternalAgentWidgetController` constructor takes `{ runId, deps: {subgraph, adapterRegistry, settings} }`. It pulls neither global singletons nor React context — testable in pure Node.
2. `viewModel(): WidgetViewModel` is a pure projection of the latest subgraph state. Two calls in the same state must return structurally-equal objects (test by deep-equal).
3. Action handlers translate to subgraph events:
   - `onSend(refinedPrompt, adapterId, timeoutMs)` → `subgraph.transition('send', payload)`.
   - `onEdit(newDraft)` → `subgraph.transition('edit', { newDraft })` (does NOT reset budget — guarded by F03 state machine).
   - `onCancel()` → `subgraph.cancel()`.
   - `onSelectAdapter(id)` / `onSetTimeout(ms)` / `onSetBudget(n)` → mutate **draft** state (not yet committed) until `onSend`. Validation rejects invalid budgets / timeouts with a typed error event delivered to the widget store (no exception).
   - `onAnswerClarification(text)` → `subgraph.resumeInterrupt({ answer: text })`.
4. Reload rehydration: if controller is constructed for a `runId` whose subgraph is not present in the slot manager, it emits an initial `ViewModel` with `phase='error'`, `error={ code:'reload', message:'Plugin reloaded during run' }`. Honors NFR-EXT-04.
5. Listener cleanup: `dispose()` unsubscribes from subgraph + cancels any pending interrupt promise — no leaked timers, no zombie listeners. Verifiable via test that runs `dispose()` and asserts subsequent state changes do not reach the controller.
6. Validation rules:
   - `timeoutMs` integer ∈ [1_000, 24 * 3600 * 1000].
   - `refineBudget` integer ∈ [1, 10].
   - `adapterId` must be a registered + enabled adapter id.
   Out-of-range values are rejected at the controller (no garbage flows into the subgraph).

## Dependencies

- **F03** — subgraph entry, state observer, slot manager.
- **F04** — clarifying-question interrupt resume contract.
- **F05** — terminal events the controller projects.
- Cross-doc:
  - [`context.md#nfr-ext-04`](../../context.md#non-functional-requirements)
  - [`../subgraph-state-machine/feature.md`](../subgraph-state-machine/feature.md)
  - [`../refine-sub-agent/feature.md`](../refine-sub-agent/feature.md)
  - [`../run-phase/feature.md`](../run-phase/feature.md)

## Implementation notes

- Existing observer pattern — `src/chat/runStateStore.ts`, `src/agent/contextSnapshotStore.ts`; see [`.agent/standards/project-structure.md`](../../../../standards/project-structure.md) for both.
- Controller / store separation — UI receives the store; never imports the controller class directly. Layering rule [`.agent/architecture/architecture.md`](../../../../architecture/architecture.md) §1 (UI → Agent).
- React 18 hook order discipline — does not apply here (no React); keep controller framework-free per [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §React 18 (hooks live in F08 only).
- `dispose()` discipline — every subscription registered must be released, per [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §"Async & Concurrency" and §"Error Handling".

## Open questions

- **OQ-01-F07** When the widget changes adapter selection mid-PREPARING (allowed by FR-EXT-27 since picker is always editable), should refine restart? **Proposed**: no — refined prompt is adapter-agnostic; selection only matters at send.
- **OQ-02-F07** Where to surface validation errors from action handlers (e.g. typed timeout out of range): an inline toast in the widget vs a `viewModel.validationError` field. **Proposed**: `viewModel.validationError` field, dismissed on next valid input — keeps widget self-contained.
