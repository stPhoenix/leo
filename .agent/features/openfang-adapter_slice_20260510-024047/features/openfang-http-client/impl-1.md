# Impl iteration 1 — F02 openfang-http-client

## Summary
Hand-rolled, dependency-free HTTP transport for the four A2A endpoints (submit/poll/cancel/download). Bearer-only auth, per-request `httpTimeoutMs` via composed AbortSignal, lenient JSON shapes, typed `OpenfangHttpError`, redact-key log helper, `LogFn` callback (no platform-logger import → keeps vault-isolation invariant).

## Files touched
- `src/agent/externalAgent/adapters/openfang/httpClient.ts` — new module: types (`A2aStatusKind`/`A2aStatus`/`A2aPart`/`A2aMessage`/`A2aArtifact`/`A2aTask`/`OpenfangHttp`/`LogFn`), `OpenfangHttpError`, `redactKey`, internal `withTimeout`, `createOpenfangHttp` factory.
- `tests/unit/externalAgent/adapters/openfang/httpClient.test.ts` — new vitest+msw suite (17 cases).

## Tests added or updated
- `httpClient.test.ts` covers AC1 (envelope + Bearer + sessionId-only-when-set), AC2 (lenient status — bare string + object form), AC3 (`task.id` returned for further calls), AC4 (cancel best-effort — 200 silent, non-2xx logs warn), AC5 (downloadArtifact returns Uint8Array + mime), AC6 (Bearer header on every authed call, abort, timeout, typed error with `bodySnippet ≤256`), AC7 (vault-isolation source scan), AC8 (redactKey + cross-call apiKey-leak guard), AC11 (defaults `messages`/`artifacts` to `[]`).

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
- Adopted OQ-01-F02 proposed resolution: `bodySnippet` tries `JSON.stringify(JSON.parse(body))` and falls back to `body.slice(0, 256)`.
- Adopted OQ-02-F02 proposed resolution: `cancelTask` awaits the fetch and logs `warn` on non-2xx / network error.

## Assumptions
- `delay('infinite')` from msw v2.13 hangs the handler indefinitely until the request signal aborts — used to test both `httpTimeoutMs` and caller-signal abort.
- `Authorization: Bearer …` only (no `X-API-Key`), per FR-OF-02; SRS §2.2 lists both as accepted but the slice mandates Bearer.

## Open questions
None.
