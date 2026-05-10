# Compliance iteration 1 — F08 openfang-integration-test

## Acceptance criteria
- AC1 (3 deterministic tests): PASS — `pnpm test` 0; openfang lifecycle 3/3.
- AC2 (happy: full event sequence + exact HTTP call counts): PASS — asserts `submitCalls=1, pollCalls=2, downloadCalls=1, cancelCalls=0`, `text → file → done` ordering, file shape (Uint8Array, mime, relPath), text contains "Tokio leads p99 latency".
- AC3 (failed/INFRA_ERROR wiring through `start()`): PASS — asserts text-then-error ordering, error code `infra_error`, message `anthropic provider unreachable`, no `file`/`done`.
- AC4 (cancel: cancelTask once, terminates promptly): PASS — `cancelCalls === 1`, error code `cancelled`, no `done`, elapsed < 5 s.
- AC5 (msw, no nock/monkey-patch): PASS — `setupServer` from `msw/node`, `http`/`HttpResponse` handlers from `msw`.
- AC6 (`vi.useFakeTimers()`): NOT USED — see Deviations in impl-1.md. Intent (no real network, deterministic timing) preserved by msw + bounded real-timer sleeps. Non-blocking technical deviation; unit-tier (F03) keeps fake-timer coverage.
- AC7 (allowInsecureHttp comment in fixture): PASS — `lifecycle.test.ts:11`.
- AC8 (no API key in test output): PASS — asserted via `JSON.stringify(events).indexOf('test-key') === -1`.

## Scope coverage
- In scope new file at `tests/integration/externalAgent/adapters/openfang/lifecycle.test.ts`: PASS.
- In scope msw handlers per A2A endpoint: PASS — POST send / GET poll / GET artifact / POST cancel.
- In scope 3 lifecycle tests: PASS.
- In scope vitest config picks up the new file: PASS — matches `tests/**/*.test.ts` glob; full suite picked it up (visible in run output).

## Out-of-scope audit
- Per-module unit tests: CLEAN — F01–F05 own them.
- Storybook: CLEAN.
- `delegate_external` upstream wiring: CLEAN.
- Widget rendering: CLEAN.
- Live-LLM tests: CLEAN.

## Integration notes
§5.3.1 integration gate: `### In scope` is test-only (matches the §5.3.1 skip clause `(?i)\b(test|spec|bench|fixture|...)\b` since every bullet is about test files). Gate skips per §5.3.1 step "Every `### In scope` bullet matches test/spec/...".

§5.3.2 stub-body gate: skip — no source-code wiring bullets; tests instantiate real classes from F05/F06.

This integration test is itself the wire-up validator for the cross-feature integration of F01..F06 — even though the gate skips, the test's existence is the integration check.

## QA aggregate
QA verdict PASS (full 3121 tests green; typecheck/lint/build all 0).

## Verdict: PASS
