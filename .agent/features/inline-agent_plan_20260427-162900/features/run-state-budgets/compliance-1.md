# Compliance iteration 1 — F04 run-state-budgets

## Acceptance criteria
- AC1 (selectMaxIterations + clamp 64): PASS — `runStateBudgets.test.ts` "returns config value within bounds" + "clamps to hard max 64".
- AC2 (perStepBudget formula): PASS — "floor((30-4)/4) === 6" verifies the canonical example; "reserves synthesize budget — when remainingIterations equals reserve, returns 0" verifies the reserve carve-out; "always at least 1 when usable budget > 0" enforces the lower bound.
- AC3 (tokenTick `over`): PASS — "returns over=true when projected total exceeds cap".
- AC4 (composeAbortSignal): PASS — three cases (host fires, wall-clock fires, cancel clears) plus already-aborted host edge case.
- AC5 (createInitialRunState): PASS — "createInitialRunState produces zero counters and routingMode".
- AC6 (pure data updates, no IO, named exports, strict TS): PASS — `runState.ts` and `budgets.ts` only mutate the passed state; no side effects beyond the timer in `composeAbortSignal`. Both files use named exports only and pass `pnpm typecheck` under strict + `noUncheckedIndexedAccess`.
- AC7 (NoteRecord shape): PASS — `appendNote` rejects out-of-range relevance and >2 KB summary; happy-path append accepts all SRS §5 fields.

## Scope coverage
- In scope "runState.ts ... InlineAgentRunState + tick mutators": PASS — `src/agent/externalAgent/adapters/inlineAgent/runState.ts`.
- In scope "budgets.ts ... selectMaxIterations / perStepBudget / tokenTick / composeAbortSignal": PASS — `src/agent/externalAgent/adapters/inlineAgent/budgets.ts`.
- In scope "Unit tests: cap selection, per-step split, token-tick over flag, abort-composition firing on either source": PASS — `runStateBudgets.test.ts`.

## Out-of-scope audit
- Out of scope "Counter wiring into actual nodes": CLEAN — no node code shipped this iteration. F11–F15 will consume the helpers.
- Out of scope "Provider usage consumption": CLEAN — `tokenTick` is data-only.
- Out of scope "Sandbox-bytes counter": CLEAN — `setSandboxBytes` is a mirror setter only; F08's tools will sync `runState.sandboxBytes` after sandbox writes.

## QA aggregate
`qa-1.md` verdict PASS — typecheck/lint/test/build all green; 1651/1651.

## Verdict: PASS
