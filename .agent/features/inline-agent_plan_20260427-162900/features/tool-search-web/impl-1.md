# Impl iteration 1 — F07 tool-search-web

## Summary

Landed `search_web` Tavily-backed tool: Zod-validated input (1–400 char query, ≤32 include/exclude domain pairs), POST body forces `include_raw_content`/`include_images` `false`, status-class mapping (`401|403→auth_failed`, `429→rate_limited`, `5xx→upstream_error`, other 4xx→`http_error`), `>maxBytes→too_large`, `not_configured` with one-shot `warn` per run when the resolved `apiKey` is empty, drops `raw_content`/`images` from results before returning, single metrics callback with lengths/counts only.

The adapter receives the *resolved* `apiKey` value (already walked by `resolveAdapterConfig`'s `safeStorage:` indirection by the time `start()` runs). Inside the adapter, the tool reads `parsedConfig.tools.searchWeb.apiKeyRef` — once resolved this is the plaintext key. The tool surface accepts `config.apiKey` directly to keep it independent of indirection logic; F16 wires the resolved value in.

## Files touched

- `src/agent/externalAgent/adapters/inlineAgent/tools/searchWeb.ts` — new: `createSearchWebTool` + `SearchWebResult`/`SearchWebMetricsEvent` types + status-class mapper.

## Tests added or updated

- `tests/unit/externalAgent/adapters/inlineAgent/searchWeb.test.ts` — 12 cases covering AC1 (Zod), AC2 (one-shot warn), AC4 (forced flags, body shape), AC5 (`too_large`), AC6 (status-class table-driven), AC7 (`raw_content`/`images` dropped), AC8 (metrics has only lengths/counts), AC9 (abort signal triggers timeout).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- The "tool omitted from agent's tool list when `enabled === false`" is a graph-wiring concern (F11/F12/F14 read `tools.searchWeb.enabled`); F07 only ships the factory. The adapter never instantiates the tool when `enabled` is false.
- `domain count cap (≤32)` enforced by Zod (`.max(32)`) regardless of Tavily's documented cap.

## Assumptions

- `resolveAdapterConfig` walks `safeStorage:` indirection at the host boundary, so `config.tools.searchWeb.apiKeyRef` becomes a plaintext key by the time the adapter sees it. F07 deliberately accepts `apiKey` directly so the tool remains testable in isolation; F16 maps `apiKeyRef` → `apiKey` when constructing the ctx.
- Tavily's error-body shape is preserved at debug level only; no field is exposed in payloads above debug.

## Open questions

- F18 will add an msw-backed integration test that exercises the real Tavily request shape; F07's unit tests use a `fetchImpl` stub that asserts the expected body.
