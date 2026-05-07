# Compliance iteration 1 — F06 canvas-mutex

## Acceptance criteria
- AC1: PASS — `tests/unit/canvas/mutex.test.ts` "blocks second acquire on same path with busy + active info".
- AC2: PASS — "distinct paths run in parallel".
- AC3: PASS — "release frees the slot for subsequent acquire".
- AC4: PASS — "release is idempotent and does not delete an unrelated subsequent holder".
- AC5: PASS — "active returns snapshot or null".
- AC6: PASS — "activeAll returns alphabetical snapshot".

## Scope coverage
- In scope "`src/agent/canvas/mutex.ts` exporting `CanvasMutex` with `acquire`/`release`/`active(path)`/`activeAll()`": PASS — `src/agent/canvas/mutex.ts:34-86`.
- In scope "`AcquireOk`, `AcquireBusy` types": PASS — exported as `CanvasMutexAcquireOk`/`CanvasMutexAcquireBusy` at `src/agent/canvas/mutex.ts:6-15`.
- In scope "Idempotent `release`": PASS — `holder.released` flag prevents double-effect.

## Out-of-scope audit
- Out of scope "FSM driver outer try/finally placement": CLEAN — F16 will own.
- Out of scope "Tool-side busy-result rendering": CLEAN — delegate tools (F19/20/21) own.

## QA aggregate
Verdict: PASS — typecheck/lint/tests/build all PASS.

## Integration notes
F06 has no wiring bullet in `### In scope`; consumers are F16/F19/F20/F21/F22. Not yet referenced from `src/main.ts`. Confirmed intentional.

## Verdict: PASS
