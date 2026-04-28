# Impl iteration 1 — F06 tool-fetch-url

## Summary

Landed `fetch_url` tool factory + tool input/output Zod schemas: scheme + URL parse validation, allowlist precedence + blocklist with glob/`*.suffix`/CIDR (IPv4) matching, per-call timeout via composed `AbortController`, response body cap with `truncated:true` and accurate `totalBytes` (header fallback when stream cancelled), JSON parse path with `invalid_json` failure, redirect chain (≤5 hops, re-validates host on every Location), HTTP 4xx/5xx → `http_error`, sensitive-header redaction at debug. `withMetrics(cb)` exposes the single per-call metrics record without leaking body / headers.

## Files touched

- `src/agent/externalAgent/adapters/inlineAgent/tools/schemas.ts` — new: Zod schemas for every inline-agent tool input/output (fetch_url, search_web, file ops, publish_artifact, extract_note, classify_task, planner). Other features (F07–F10, F11, F13) consume the schemas they need.
- `src/agent/externalAgent/adapters/inlineAgent/tools/fetchUrl.ts` — new: `createFetchUrlTool`, `checkHost`, `matchHostPattern`, plus types `FetchUrlConfig`, `FetchUrlMetricsEvent`, `FetchUrlResult`.

## Tests added or updated

- `tests/unit/externalAgent/adapters/inlineAgent/fetchUrl.test.ts` — 17 cases covering AC1 (invalid scheme + malformed URL), AC2/AC3 (allow precedence, glob, CIDR, default blocklist), AC4 (timeout fires through composed AbortController), AC5 (truncation surfaces with `totalBytes`), AC6 (single metrics event with metadata only), AC7 (redirect re-validation + over-hop limit), AC8 (Zod boundary), JSON parse + invalid_json, HTTP 4xx → http_error.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- Open-question resolution: CIDR matching is implemented inline (≈30 LOC) — IPv4 only; `169.254.0.0/16` covered. IPv6 deferred (no SRS coverage).
- DNS-rebind exposure documented in tool description as "v1: trust the renderer's `fetch` resolver. Document the residual risk".
- `responseFormat: 'json'` content-type sanity check: tool tries `JSON.parse(body)` and falls back to `error: 'invalid_json'`; no header check (the model can request a `text` re-fetch).

## Assumptions

- `withMetrics` is a side-channel: F12/F14 will call `tool.withMetrics(...)` so the metrics event flows into the bridge. The metrics callback is not part of the tool input/output and never appears in payloads.
- Stream-cancel after byte cap relies on `Content-Length` header for `totalBytes` accuracy when the underlying response was not fully read.

## Open questions

- Eventually compose with `runState` to count tokens spent on tool args (FR-IA-43); F11+ wire that.
