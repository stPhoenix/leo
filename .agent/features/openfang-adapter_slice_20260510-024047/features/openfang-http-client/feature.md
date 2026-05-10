# F02 — A2A HTTP transport

## Purpose

Provide a small, dependency-free HTTP client that exposes the four A2A endpoints the adapter needs: submit, poll, cancel, and artifact-download. The transport is the only place in the openfang slice that calls `fetch`. It centralizes Bearer-header injection, per-request timeouts, abort plumbing, lenient JSON parsing, and key-redacted logging — keeping the upper layers (polling, artifacts, adapter shell) pure of network concerns.

Implements [`context.md`](../../context.md) FR-OF-01, FR-OF-02, FR-OF-03 (capture side), FR-OF-13 (cancel call side), FR-OF-21, FR-OF-30, NFR-OF-04, NFR-OF-05, NFR-OF-08, NFR-OF-09, NFR-OF-10.

## Scope

**In scope**

- New file `src/agent/externalAgent/adapters/openfang/httpClient.ts` exporting a single factory `createOpenfangHttp(config: OpenfangConfig, logFn: LogFn): OpenfangHttp` plus the `OpenfangHttp` interface:
  - `submitTask(input: { text: string; sessionId?: string }, signal: AbortSignal): Promise<A2aTask>`
    - Builds the JSON-RPC envelope per [`../../../../srs/openfang.md`](../../../../srs/openfang.md) §3 (`jsonrpc: "2.0"`, `id: 1`, `method: "tasks/send"`, `params.message.parts: [{type:"text", text}]`, `params.sessionId` only if `sessionId` non-empty).
    - `POST <baseUrl>/a2a/tasks/send` with `Authorization: Bearer <apiKey>`, `Content-Type: application/json`.
    - Returns the parsed `A2aTask` JSON (typed; see below).
  - `pollTask(taskId: string, signal: AbortSignal): Promise<A2aTask>` — `GET <baseUrl>/a2a/tasks/{taskId}`. Bearer header sent (harmless on a public endpoint; per SRS §2.2 keeps client uniform).
  - `cancelTask(taskId: string, signal: AbortSignal): Promise<void>` — `POST <baseUrl>/a2a/tasks/{taskId}/cancel`, body `{}`. One-shot — caller does not retry. Errors logged at `warn` and swallowed (cancel is best-effort per FR-OF-14).
  - `downloadArtifact(relUrl: string, signal: AbortSignal): Promise<{ bytes: Uint8Array; mime: string | undefined; size: number }>` — `GET <baseUrl><relUrl>`, returns the raw body as `Uint8Array`. Used by F04.
- `LogFn` type alias: `(level: 'debug' | 'info' | 'warn', msg: string, fields?: Readonly<Record<string, unknown>>) => void`. The HTTP client emits via this callback rather than importing `Logger` directly (NFR-OF-02 vault-isolation; the callback is supplied by F05 and forwards into `ExternalEvent.log`).
- TypeScript types co-located in `httpClient.ts`:
  - `A2aStatusKind = 'submitted' | 'working' | 'inputRequired' | 'completed' | 'cancelled' | 'failed'` (matches SRS §3 list verbatim).
  - `A2aStatus = A2aStatusKind | { state: A2aStatusKind; message?: unknown }` (FR-OF-06).
  - `A2aTask` shape mirroring the SRS §4 example: `{ id, sessionId?, status, messages: A2aMessage[], artifacts: A2aArtifact[] }`.
  - `A2aMessage`, `A2aArtifact`, `A2aPart` discriminated unions covering at minimum `text`, `data`, `fileRef`, plus a permissive `{ type: string }` fallback so unknown part types parse without throwing (NFR-OF-08).
- Internal helper `redactKey(headers): Record<string, string>` that copies headers and replaces any `authorization` value with `'Bearer ***'` for safe `debug` logging (FR-OF-30, NFR-OF-05).
- Internal helper `withTimeout(signal: AbortSignal, ms: number): { signal: AbortSignal; cancel(): void }` — composes the caller's signal with an internal `AbortController` that auto-aborts after `ms` to enforce `httpTimeoutMs` per request (NFR-OF-04). On timeout, the rejection error has `code = 'http_timeout'`.
- Typed errors: `class OpenfangHttpError extends Error { constructor(public readonly status: number, public readonly endpoint: string, public readonly bodySnippet: string) {} }`. Thrown on non-2xx for the three authenticated calls; the upper layers (F03 polling, F05 adapter) catch and map by `status` per FR-OF-16/17/18/19.
- Unit tests at `tests/unit/externalAgent/adapters/openfang/httpClient.test.ts` using `msw`:
  - submit happy path — verifies envelope, Bearer header, `sessionId` included only when provided
  - submit returns task with leniently-parsed status (string OR object form) — both shapes parsed identically
  - poll happy path
  - cancel: 200 → resolves; non-2xx → resolves and logs `warn` (best-effort)
  - download returns `Uint8Array` of correct length (cross-check `arrayBuffer().byteLength === size`)
  - 401/403/404/500 each produce an `OpenfangHttpError` with the right `status` and `endpoint`
  - request honors `httpTimeoutMs`: when handler hangs longer than the configured timeout, rejects with `code: 'http_timeout'` (uses `vi.useFakeTimers()`)
  - `redactKey` on a `debug` log: header value is `Bearer ***`, never the real key — assertion against the `LogFn` mock
  - signal abort mid-request rejects with `AbortError`

**Out of scope**

- Polling backoff loop (F03 owns the loop; F02 only owns single-request transport).
- Status interpretation beyond parsing (F03 decides which states are terminal).
- Artifact part-type enumeration (F04 walks the task structure; F02 just provides `downloadArtifact`).
- Failure-prefix decoding (F05 owns the text-of-last-message decoder).
- Insecure-HTTP rejection (F05 enforces FR-OF-29 before any HTTP call).
- Retries — F02 does **not** retry. Retry budgets live in callers (F03 for poll; F05 for submit).

## Acceptance criteria

1. `submitTask` issues exactly one `POST` to `<baseUrl>/a2a/tasks/send` with the JSON-RPC envelope and Bearer header. `sessionId` appears in the body iff the input field is set. (FR-OF-01, FR-OF-02, FR-OF-21.)
2. The submit response is parsed into a typed `A2aTask` whose `status` field accepts both bare-string and object forms without runtime error. (FR-OF-06, NFR-OF-08.)
3. The submit caller can read `task.id` from the returned object and pass it to subsequent `pollTask` / `cancelTask` / artifact-download URL composition. (FR-OF-03.)
4. `cancelTask` is one-shot and logs `warn` instead of throwing on non-2xx — the upper layer's cancel flow does not depend on success. (FR-OF-13 call side.)
5. `downloadArtifact` returns raw bytes as `Uint8Array` and exposes the response `Content-Type`. (Consumed by F04 for `ExternalEvent.file.mime`.)
6. Every authenticated call:
   - sends `Authorization: Bearer <apiKey>` (never `X-API-Key`) (FR-OF-02);
   - is bound to a composed AbortSignal (caller's signal + per-request `httpTimeoutMs`) (NFR-OF-04);
   - returns a typed `OpenfangHttpError` on non-2xx with `status`, `endpoint`, and a body snippet ≤ 256 chars (FR-OF-30 — the snippet itself never includes the key, since the daemon does not echo it).
7. `LogFn` is the only logging surface. The HTTP client never imports `@/platform/logger` or any other plugin internals (vault-isolation per NFR-OF-02, enforced by ESLint rule installed in F01 of the prior slice).
8. `redactKey` strips the apiKey from any log entry that includes request headers; verified by a test that registers a `vi.fn()` `LogFn` and asserts no recorded log contains the literal key string. (FR-OF-30, NFR-OF-05.)
9. No new top-level dependency added to `package.json`; the client uses platform `fetch` only. (NFR-OF-10.)
10. The four endpoint URLs match SRS §TL;DR / §3 / §4 / §5 / §6 character-for-character (no double slashes, no trailing slashes).
11. Unknown JSON shapes (extra keys, missing optional keys) do not throw — `messages` and `artifacts` default to `[]` if absent. (NFR-OF-08.)

## Dependencies

- **F01** — for the `OpenfangConfig` type consumed by `createOpenfangHttp`.
- Cross-doc:
  - [`context.md#fr-of-01`](../../context.md#functional-requirements) … FR-OF-30 references
  - [`../../../../srs/openfang.md`](../../../../srs/openfang.md) §2.2, §3, §4, §5, §6 (endpoint contracts)
  - [`../openfang-config-schema/feature.md`](../openfang-config-schema/feature.md)

## Implementation notes

- Async / abort discipline — see [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §"Async & Concurrency".
- Error-handling pattern: typed error class at boundary, no thrown errors from the caller-facing happy paths beyond `OpenfangHttpError`. See [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §"Error Handling".
- Logging — structured key/value, debug-gated for payloads. See [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §"Logging" and the prior slice's namespace convention in [`../../../external-agent_slice_20260427-022536/features/logging-bundle/feature.md`](../../../external-agent_slice_20260427-022536/features/logging-bundle/feature.md).
- Vault-isolation invariant — see [`../../../external-agent_slice_20260427-022536/features/adapter-contract/feature.md`](../../../external-agent_slice_20260427-022536/features/adapter-contract/feature.md) §"Acceptance criteria" #2 and the ESLint rule it installed.
- msw test pattern — see [`.agent/standards/tech-stack.md`](../../../../standards/tech-stack.md) §"Testing" and existing usage in `tests/integration/`.
- Bundle budget — see [`.agent/standards/tech-stack.md`](../../../../standards/tech-stack.md) §"Bundle Budget" (no new top-level deps; hand-rolled fetch wrapper).

## Open questions

- **OQ-01-F02** Should `OpenfangHttpError`'s `bodySnippet` be plaintext or always JSON-stringified? Daemon error bodies are JSON per SRS §2.3; non-JSON would indicate a non-daemon endpoint hit. **Proposed**: try `JSON.stringify(JSON.parse(body))` and fall back to raw `body.slice(0, 256)`.
- **OQ-02-F02** Should `cancelTask` await `await fetch(...)` to completion or kick off and return immediately? **Proposed**: await — gives us a useful `warn` log when cancel call itself fails, with negligible latency.
- **OQ-03-F02** Should the client expose a `healthCheck()` for the public agent-card endpoint (`/.well-known/agent.json`)? Out of v1 (see context.md OQ-01) — but we may want the function exported for testing connectivity programmatically. **Proposed**: defer.
