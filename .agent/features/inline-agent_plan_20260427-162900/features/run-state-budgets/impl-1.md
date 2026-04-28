# Impl iteration 1 — F04 run-state-budgets

## Summary

Landed `InlineAgentRunState` data shape + mutators (`runState.ts`) and pure budget helpers (`budgets.ts`): per-branch iteration cap selection with hard max 64, per-step budget split with synthesize reserve, token-tick `over` flag, and composed `AbortSignal` (host + wall-clock timer with `cancel`/`reason`).

## Files touched

- `src/agent/externalAgent/adapters/inlineAgent/runState.ts` — new: `InlineAgentRunState`, `NoteRecord`, `PublishedArtifact`, `createInitialRunState`, `incrementIterations`, `addTokens`, `setRoute`, `setPlan`, `advanceStep`, `appendNote`, `appendPublishedArtifact`, `setSandboxBytes`, `NOTE_SUMMARY_MAX_BYTES`.
- `src/agent/externalAgent/adapters/inlineAgent/budgets.ts` — new: `selectMaxIterations`, `perStepBudget`, `tokenTick`, `composeAbortSignal`, `HARD_MAX_ITERATIONS`, `SYNTHESIZE_RESERVE_DEFAULT`.

## Tests added or updated

- `tests/unit/externalAgent/adapters/inlineAgent/runStateBudgets.test.ts` — 17 cases: initial state shape, mutator updates, negative-delta rejection, NoteRecord shape (relevance + summary cap), iteration cap selection (simple/multistep/clamp), per-step budget (the spec example `(30-4)/4 → 6`, reserve enforcement, zero-step path, lower bound 1), token-tick over/under, abort composition (host fires, timeout fires, cancel clears, already-aborted host).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- AC2 wording mentions "reservation arithmetic for the last step recovers leftover" — the implementation reserves `synthesizeReserve` once up front and divides the remainder evenly; leftover from non-divisible budgets simply stays unused (the synthesizer claims a separate min-4 reserve, so over-spending is bounded). Tests assert the canonical `(30-4)/4 = 6` answer.
- `composeAbortSignal` returns an extra `reason()` accessor not strictly required by FR-IA-44 — used by F16 to distinguish `'timeout'` vs `'cancel'` exit codes without re-checking either signal.

## Assumptions

- `runState` is a mutable object protected by TypeScript's structural typing rather than `Object.freeze`; matches the SRS §5 "readonly" sub-fields and avoids per-tick allocations on the hot loop.
- `synthesizeReserve` defaults to 4 — hard-coded per FR-IA-41; no config knob.

## Open questions

- F11+ will plug `tokenTick` into the model-call sites; the helper does not consume provider `usage` itself.
