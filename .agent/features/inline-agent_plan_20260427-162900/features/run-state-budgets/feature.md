# F04 — Run state + budget helpers

## Purpose

Land the `InlineAgentRunState` data shape (route, plan, currentStep, notes, scratchpad, iterations, cumulativeTokens, sandboxBytes, publishedArtifacts, startedAt) and the pure `budgets.ts` helpers that pick per-branch iteration caps, split per-step budgets via `floor(remaining/remainingSteps)` with rollover, tick token usage from estimator + observed `usage`, and compose the wall-clock `AbortController` with the host signal. Covers [context.md#fr-ia-41](../../context.md#functional-requirements) FR-IA-41 (helper), FR-IA-42, FR-IA-43, FR-IA-44.

## Scope

In scope:
- `src/agent/externalAgent/adapters/inlineAgent/runState.ts`:
  - `NoteRecord` + `InlineAgentRunState` types (per [context.md#functional-requirements](../../context.md#functional-requirements) §5 of SRS).
  - `createInitialRunState({ runId, sandboxRoot, routingMode, startedAt }): InlineAgentRunState`.
  - Tick mutators: `incrementIterations(state, n=1)`, `addTokens(state, n)`, `setRoute(state, route)`, `setPlan(state, plan)`, `advanceStep(state)`, `appendNote(state, record)`.
- `src/agent/externalAgent/adapters/inlineAgent/budgets.ts`:
  - `selectMaxIterations(route, config) -> number` (clamps to hard max 64).
  - `perStepBudget({ remainingIterations, remainingSteps, synthesizeReserve = 4 })` — per FR-IA-41.
  - `tokenTick({ state, addedInputEstimate, observedUsage })` returning `{ over: boolean, total: number }`.
  - `composeAbortSignal(host: AbortSignal, wallClockMs: number)` returning `{ signal, cancel }` with internal timer.
- Unit tests: cap selection (simple/multistep/clamp at 64), per-step split (rollover happens, last step gets leftover, `synthesize` reserves ≥4), token-tick `over` flag, abort-composition firing on either source.

Out of scope:
- Counter wiring into actual nodes — happens in F11/F12/F13/F14/F15.
- Provider `usage` field consumption — wiring lives in the model-call sites; F04 only owns the helper.
- Sandbox-bytes counter — already lives in F03's `Sandbox` instance. `runState.sandboxBytes` mirrors it for read-only convenience.

## Acceptance criteria

1. `selectMaxIterations('simple', { budgets: { maxIterationsSimple: 12, ... } }) === 12`; same for `'multistep'` returning 32; configured > 64 clamps to 64 ([context.md#fr-ia-42](../../context.md#functional-requirements)).
2. `perStepBudget({ remainingIterations: 30, remainingSteps: 4, synthesizeReserve: 4 })` returns `floor((30-4)/4) === 6` and reservation arithmetic for the last step recovers leftover ([context.md#fr-ia-41](../../context.md#functional-requirements)).
3. `tokenTick` returns `over: true` when `state.cumulativeTokens + addedInputEstimate + observedUsage > config.budgets.maxTokens`; this signals callers to surface `error.code='token_limit'` ([context.md#fr-ia-43](../../context.md#functional-requirements)).
4. `composeAbortSignal(hostSignal, 300_000)` returns a signal that fires when either the host fires or the 300_000 ms timer elapses; `cancel()` clears the internal timer ([context.md#fr-ia-44](../../context.md#functional-requirements)).
5. `createInitialRunState` produces `route: null`, `notes: []`, `scratchpad: ''`, `publishedArtifacts: []`, all counters zero, `routingMode` from config.
6. Mutators are pure data updates (no IO); idiomatic TS strict (no `any`); named exports only.
7. NoteRecord shape matches SRS §5 (`id`, `stepIndex`, `sourceUrl?`, `title`, `summary` ≤2 KB, `relevance ∈ [0,1]`, `createdAt`).

## Dependencies

- [F01 — adapter scaffold](../adapter-scaffold/feature.md) (consumer site).
- [`src/agent/tokenEstimator.ts`](../../../../src/agent/tokenEstimator.ts) — input estimation.
- [context.md#fr-ia-41](../../context.md#functional-requirements)..FR-IA-44.

## Implementation notes

- Strict TS, no enums, `as const` unions: [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) §"TypeScript".
- Pure helpers vs IO nodes: [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) §"LangGraph / Agent Layer".
- Token estimator existing module: [`src/agent/tokenEstimator.ts`](../../../../src/agent/tokenEstimator.ts).
- Abort composition pattern echoes [`src/agent/agentRunner.ts`](../../../../src/agent/agentRunner.ts) — review existing composition before reimplementing.
- Best-practices fail-fast: throw on negative budgets / negative tokens at boundary ([`.agent/standards/best-practices.md`](../../../../.agent/standards/best-practices.md) §"Core Principles").

## Open questions

- Token ticking when provider lacks a `usage` field — fallback to estimator-only (per [context.md#open-questions](../../context.md#open-questions) OD-IA-4). Need to enumerate which entries in `providers/registry.ts` lack `usage` today (LM Studio? OpenAI-compat?). Verify in F11 implementation when classifier first hits the model.
- Should `runState` be frozen (`Object.freeze`) and replaced via `produce`-style updates, or mutated in place? SRS §5 marks fields `readonly` selectively. Lean on TypeScript `readonly` + permitted mutators rather than runtime freeze (perf).
- Is the `synthesizeReserve = 4` hard-coded or configurable? SRS treats it as fixed minimum. Keep hard-coded.
