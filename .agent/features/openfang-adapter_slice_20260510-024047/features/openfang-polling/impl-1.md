# Impl iteration 1 — F03 openfang-polling

## Summary
Pure timing/state polling driver with exponential back-off (1.5×), abort-responsive sleep, hard timeout, and bounded 5xx retry budget that resets on 2xx. Type-only imports from `./httpClient`; no platform / fetch imports.

## Files touched
- `src/agent/externalAgent/adapters/openfang/polling.ts` — `extractStatusKind`, `isTerminalState`, `abortableSleep`, `pollUntilTerminal`, `PollDeps`/`PollOpts`/`PollResult` types.
- `tests/unit/externalAgent/adapters/openfang/polling.test.ts` — 31 vitest cases, fake timers for `abortableSleep` only; `pollUntilTerminal` driven by injected `sleep`+`now` (no real clock needed).

## Tests added or updated
- AC1 (4-variant return + 401 re-throw): "5xx exhaustion → transient_exhausted with last status", "401 re-thrown unmodified".
- AC2 (back-off math table): "back-off math" 7-row table.
- AC3 (status parsing): "extractStatusKind" 4-case table.
- AC4 (terminal predicate): "isTerminalState" 6-case table.
- AC5 (abort responsiveness): "aborts when signal trips before next poll", "aborts when in-flight pollTask throws AbortError", "abortableSleep resolves on mid-sleep abort within 50ms".
- AC6 (timeout): "returns timeout once deadline passes", "inputRequired is non-terminal — loop continues until timeout".
- AC7 (5xx retry, budget reset): "5xx then recovery → terminal".
- AC8 (401/403/404 re-thrown): covered by 401 case (403/404 share branch — same code path).
- AC9 (vault isolation, type-only): "vault isolation — module imports only ./httpClient".
- AC10 (fake timers): `abortableSleep` block uses `vi.useFakeTimers()`.

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
- Loop uses `for (;;)` instead of `while (true)` to satisfy ESLint `no-constant-condition`. Behaviour identical.
- 403/404 not asserted with their own test cases — same code branch as 401 (`status` not >=500 → re-throw). Adding two more cases would test the language, not the contract; one representative test is sufficient.

## Assumptions
- `OpenfangHttpError` thrown by `pollTask` is the only typed error class; all other errors propagate untouched (matches F02 contract).
- `signal.aborted` short-circuit at the top of the loop and inside the `catch` covers both pre-abort and mid-call abort.

## Open questions
None.
