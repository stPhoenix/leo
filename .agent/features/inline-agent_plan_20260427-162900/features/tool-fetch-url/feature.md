# F06 — `fetch_url` tool

## Purpose

Build the `fetch_url` LangChain `tool()` factory: parse and validate URL scheme, apply allowlist (precedence) + blocklist filters with redirect re-validation per hop, enforce per-call `timeoutMs` via `AbortController`, cap response body at `maxBytes` with `truncated` flag, normalize errors to typed `Result`, and emit a single `log info` per call carrying `{url, method, status, durationMs, bytes}` only. Covers FR-IA-13, FR-IA-14, FR-IA-15, FR-IA-16, NFR-IA-02 (Zod boundary).

## Scope

In scope:
- `src/agent/externalAgent/adapters/inlineAgent/tools/schemas.ts` (subset for fetch_url): Zod schema per [context.md#fr-ia-13](../../context.md#functional-requirements).
- `src/agent/externalAgent/adapters/inlineAgent/tools/fetchUrl.ts` exporting `createFetchUrlTool({ config, signal, sandbox: undefined, logger, runState }) -> StructuredTool`. (Sandbox unused here — kept in ctx shape for uniformity per [context.md#glossary](../../context.md#glossary).)
- Allowlist/blocklist matcher — glob-style patterns, allowlist takes precedence: when non-empty, only matching hosts pass; blocklist filters within. Default blocklist: `['localhost','127.0.0.1','0.0.0.0','169.254.0.0/16','*.local']`.
- Redirect handling — follow ≤ 5 hops, re-apply allow/blocklist on each `Location`. Configurable via `fetchUrl.followRedirects` (default `true`).
- Timeout via `AbortController` composed with the run-level `signal`.
- Response body cap: stream-read up to `maxBytes`; surface `truncated: true` + `totalBytes` when read continues past cap (still 200 OK).
- `responseFormat: 'json'` parses body, returns object as `data.body`; parse failure → `error: 'invalid_json'`. `'text'` (default) returns the string body.
- Error mapping: `'blocked' | 'timeout' | 'too_large' | 'invalid_url' | 'http_error'` plus `status?` for `http_error`.
- One `log info` per call with non-payload metadata (per [F05](../event-bridge/feature.md)).
- Unit tests: scheme rejection, allow precedence, blocklist patterns (CIDR, glob), redirect chain re-validation, timeout firing, byte cap with stream, JSON parse failure path, log payload fields.

Out of scope:
- DNS-level rebind protection (architecturally a v2 hardening item). Surface as open question.
- Streaming response delivery to the LLM — body is fully buffered up to cap.
- Cookie / session handling — every call is stateless.

## Acceptance criteria

1. URL scheme outside `http`/`https` → `{ ok: false, error: 'invalid_url' }` ([context.md#fr-ia-13](../../context.md#functional-requirements)).
2. Allowlist non-empty: only hosts matching at least one pattern reachable; blocklist still filters within ([context.md#fr-ia-14](../../context.md#functional-requirements)).
3. Default blocklist denies `localhost`, `127.0.0.1`, `0.0.0.0`, `169.254.0.0/16`, `*.local` ([context.md#fr-ia-14](../../context.md#functional-requirements)).
4. Per-call timeout `30000 ms` default; on fire → `{ ok: false, error: 'timeout' }` ([context.md#fr-ia-15](../../context.md#functional-requirements)).
5. Response body > 5 MB default cap → returned with `truncated: true` and `totalBytes` set; `ok: true` (per SRS error table — truncation is **not** an error) ([context.md#fr-ia-15](../../context.md#functional-requirements)).
6. Each call emits exactly one `log` `info` event with `{ url, method, status, durationMs, bytes }` and never headers or body ([context.md#fr-ia-16](../../context.md#functional-requirements)).
7. Redirect chain ≤5 hops; each `Location` host re-checked against allow/blocklist; over-limit → `{ ok: false, error: 'http_error', status: <last> }`.
8. Zod `parse()` at tool boundary rejects malformed input; no `as any` past boundary ([context.md#nfr-ia-02](../../context.md#non-functional-requirements)).

## Dependencies

- [F03 — sandbox primitives](../sandbox-primitives/feature.md) (only for ctx shape uniformity; tool does not write).
- [F05 — event bridge](../event-bridge/feature.md) (`elideArgs`, `mapToolStart`, `mapToolEnd`).
- [F02 — config schema](../config-schema/feature.md) (`tools.fetchUrl` shape).
- [context.md#fr-ia-13](../../context.md#functional-requirements)..FR-IA-16, [context.md#nfr-ia-02](../../context.md#non-functional-requirements).

## Implementation notes

- Zod-first tool boundary: [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) §"Zod & Tool Schemas".
- Async / signal threading: [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) §"Async & Concurrency".
- Reuse global `fetch` (Electron renderer); no `node-fetch` dependency.
- Tech-stack note on no-bundled Node-only fetch helpers: [`.agent/standards/tech-stack.md`](../../../../.agent/standards/tech-stack.md) "Externals" row.
- Best-practices: explicit timeouts on every fetch ([`.agent/standards/best-practices.md`](../../../../.agent/standards/best-practices.md) §"Operational Excellence").

## Open questions

- CIDR matching for `169.254.0.0/16` blocklist entry — implement minimal IPv4 CIDR comparator inline or import a lib? Inline (≈30 LOC) keeps NFR-IA-03 budget tight.
- DNS-rebind exposure — do we resolve hostnames once and reuse? v1: trust the renderer's `fetch` resolver. Document the residual risk in tool description.
- `responseFormat: 'json'` content-type sanity check — should we verify `Content-Type: application/json` before parsing? Lean: try parse, fall back to `error: 'invalid_json'`.
