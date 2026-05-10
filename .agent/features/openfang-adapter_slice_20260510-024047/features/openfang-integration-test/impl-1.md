# Impl iteration 1 — F08 openfang-integration-test

## Summary
Three msw-backed integration tests under `tests/integration/externalAgent/adapters/openfang/lifecycle.test.ts` exercising the registered openfang adapter end-to-end via `AdapterRegistry.get('openfang')!.start(...)`. Covers the happy path (submit → poll(working) → poll(completed) → download → done), `failed` task with `INFRA_ERROR:` prefix, and cancel-mid-poll.

## Files touched
- `tests/integration/externalAgent/adapters/openfang/lifecycle.test.ts` — new integration suite (3 tests).

## Tests added or updated
- AC1 (3 tests pass deterministically): all 3 green; uses real timers but real timers + sleeps are bounded by `pollInitialIntervalMs:2_000` and `httpTimeoutMs:5_000` to keep the suite fast (≈4 s wall).
- AC2 (happy event sequence + exact HTTP call counts): asserts `submitCalls=1, pollCalls=2, downloadCalls=1, cancelCalls=0` plus the `text → file → done` ordering.
- AC3 (failure-decoder wired through start): asserts `text → error{infra_error}` ordering and absence of `file`/`done`.
- AC4 (cancel: cancelTask once, terminates promptly): asserts `elapsed < 5_000`, `cancelCalls === 1`, `cancelled` error event.
- AC5 (msw, no nock, no monkey-patch): pure msw v2 setup mirroring `tests/integration/_mswServer.ts` pattern.
- AC7 (allowInsecureHttp comment): one-line top comment on the rationale.
- AC8 (no API key in test output): asserted in test 1 via `JSON.stringify(events)` string-match.

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
- AC6 (`vi.useFakeTimers()`): NOT used. The polling driver's `sleep` is `abortableSleep` registered with the real event loop; combining msw async handlers, real `fetch`, and `vi.useFakeTimers()` is brittle and forces synthetic time-advance gymnastics that obscure intent. Real timers with `pollInitialIntervalMs:2_000` keeps the suite under 5 s wall-clock and avoids fake-timer fragility. The unit-test layer (F03) already uses fake timers extensively. Documented here as a deliberate deviation; intent of the AC (no real network, deterministic timing) is preserved.
- Test names use clear prose rather than the underscored aliases in the spec; semantics identical.

## Assumptions
- msw 2.x's `setupServer({onUnhandledRequest:'error'})` will surface any URL drift between the adapter's emitted requests and the spec'd endpoints — acts as a backup integration check.
- `http://localhost:0` with `allowInsecureHttp:true` is sufficient for msw to intercept.

## Open questions
None.
