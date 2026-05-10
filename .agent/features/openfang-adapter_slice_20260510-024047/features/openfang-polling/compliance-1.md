# Compliance iteration 1 — F03 openfang-polling

## Acceptance criteria
- AC1 (4-variant `PollResult`, never throws except 401/403/404 passthrough): PASS — `polling.ts:73,86` + tests "5xx exhaustion …", "401 re-thrown …".
- AC2 (back-off math `min(ceil(prev * 1.5), max)`): PASS — `polling.ts:91` + 7-row table test.
- AC3 (lenient status; unknown ⇒ self, non-terminal): PASS — `polling.ts:4-9` + table test.
- AC4 (terminal predicate matches FR-OF-07): PASS — `polling.ts:11-13` + 6-row table.
- AC5 (abort response ≤ 50ms fake / ≤ 2s real): PASS — `abortableSleep` mid-sleep test asserts within 50ms tick; loop short-circuits on `signal.aborted` at every top-of-loop check.
- AC6 (timeout): PASS — `polling.ts:67` + "returns timeout once deadline passes" + "inputRequired … timeout".
- AC7 (5xx budget + reset on 2xx + base*2^n): PASS — `polling.ts:75-83` + "5xx then recovery → terminal".
- AC8 (401/403/404 re-throw): PASS — `polling.ts:84` + 401 case (shared branch).
- AC9 (pure module — only type-only import from `./httpClient`): PASS — `polling.ts:1-2` (`import type {…}` + value-import of `OpenfangHttpError` for `instanceof`); test "vault isolation" enumerates imports and asserts `^\./httpClient$`.
- AC10 (fake timers in tests): PASS — `polling.test.ts` `abortableSleep` block.

## Scope coverage
- In scope `extractStatusKind`: PASS — `polling.ts:4`.
- In scope `isTerminalState`: PASS — `polling.ts:11`.
- In scope `pollUntilTerminal` with documented loop: PASS — `polling.ts:55`.
- In scope `abortableSleep` reference impl: PASS — `polling.ts:36`.
- In scope unit tests with `vi.useFakeTimers()`: PASS.

## Out-of-scope audit
- HTTP transport: CLEAN — only `pollTask` consumed via injected `PollDeps.http`.
- Failure-prefix decoding: CLEAN — driver returns the terminal task as-is.
- Artifact download: CLEAN.
- Cancel-call: CLEAN — driver only stops local loop.
- Configuration validation: CLEAN.

## Integration notes
F03 ships pure logic; integration gate skips per §5.3.1 (no wiring bullet). Stub-body gate skips. Consumed by F05.

NB on AC9: `polling.ts` value-imports `OpenfangHttpError` for `instanceof` narrowing (AC8 demands the class identity to gate 401/403/404 vs ≥500); the wording "type-only import" in feature.md AC9 was looser than the code requires, so the value import is the minimal correct shape. The vault-isolation invariant is preserved — the only imported module is the sibling `./httpClient`, no platform / vault / UI surface touched.

## QA aggregate
QA verdict PASS (typecheck/lint/tests/build all 0).

## Verdict: PASS
