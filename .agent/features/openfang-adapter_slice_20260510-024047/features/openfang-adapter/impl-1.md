# Impl iteration 1 — F05 openfang-adapter

## Summary
`OpenfangAdapter` shell wires F01–F04 into the contract: config validation → insecure-transport guard → 5xx-budgeted submit → cancel-on-abort hookup → polling driver → terminal-task interpretation (text + data + failure-prefix decode) → artifact download → done. Helpers `decodeFailureText` and `mapHttpError` are pure modules.

## Files touched
- `src/agent/externalAgent/adapters/openfang/index.ts` — adapter class + orchestration generator + redact-on-log helper + submit-retry helper.
- `src/agent/externalAgent/adapters/openfang/failureDecoder.ts` — pure prefix decoder.
- `src/agent/externalAgent/adapters/openfang/httpErrorMapping.ts` — pure status × context mapper.
- `tests/unit/externalAgent/adapters/openfang/index.test.ts` — 36 vitest cases (decoder table, mapper table, adapter happy/error paths, vault-isolation source scan).

## Tests added or updated
- AC1 (zero-arg constructor, no Vault/Logger/Settings deps): "OpenfangAdapter constructs with zero arguments".
- AC2 (yields valid `ExternalEvent` shapes): every test asserts `events[*].type` against the contract.
- AC3 (config validation precedes HTTP): "invalid_config: yields one error and no logs" — server has no handler so any HTTP call would 500 via msw `onUnhandledRequest:'error'`.
- AC4 (insecure-transport guard): "insecure_transport: blocks http:// when allowInsecureHttp=false; no network call".
- AC5 (failure decoder 4 + fallback): table-test 7 rows.
- AC6 (HTTP-error map covers 401/403/404 contexts + 4xx/5xx): table-test 12 rows.
- AC7 (cancel: cancelTask once, aborted ≤ 2 s, error event): "cancel during poll" asserts elapsed < 3 s, `cancelCalls === 1`, error code `cancelled`.
- AC8 (text precedes file): "happy path" asserts `textIdx < fileIdx`.
- AC9 (data parts → fenced JSON block after text): "data parts render as fenced JSON code block after text".
- AC10 (no API key in any log): "happy path: text → file → done with no API key in any log".
- AC11 (failureDecoder + httpErrorMapping pure): vault-isolation scan tests.
- AC12 (ESLint passes against all four files): full `pnpm lint` 0 errors.

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
- Adopted OQ-01-F05 proposed resolution: pass through `parsed.sessionId` if non-empty.
- Adopted OQ-03-F05 proposed resolution: cancel-on-abort uses `AbortSignal.timeout(2_000)` rather than the already-aborted `input.signal`.
- Added a `'cancelled'` terminal-task short-circuit (status `cancelled` from the daemon → emit `cancelled` error rather than `done`). Not explicitly listed in feature.md step 9 but consistent with intent — `cancelled` is a terminal state and shouldn't yield `done` like `completed` does.
- Submit retry uses `abortableSleep` from F03 (already in scope) — keeps the cancel-during-backoff path responsive.

## Assumptions
- `input.refinedAsk` is the user-facing text passed to the daemon (matches the prior slice's contract).
- `formatLogMsg` concatenates message + JSON fields; the consumer-side namespace (`externalAgent.adapter.openfang.*`) is applied upstream, not here.
- `AbortSignal.timeout` is available in the Electron renderer (Node 18+; Obsidian 1.5 ships modern V8).

## Open questions
None.
