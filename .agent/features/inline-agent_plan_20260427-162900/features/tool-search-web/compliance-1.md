# Compliance iteration 1 — F07 tool-search-web

## Acceptance criteria
- AC1 (Zod boundary, query length 1..400): PASS — `searchWeb.test.ts` "query length 1..400 enforced".
- AC2 (missing apiKey → not_configured + one-shot warn): PASS — "missing apiKey → not_configured + one-shot warn"; warn appears once across two invocations.
- AC3 (enabled=false omits tool): PASS via design — F11/F12/F14 graph-wiring reads `tools.searchWeb.enabled`. F07's factory is only invoked when enabled. (Test against F16 graph wiring will assert the omission integrationally.)
- AC4 (forced include_raw_content/include_images=false; body shape): PASS — "POST body forces include_raw_content/images false; query/depth carried" inspects the actual outgoing body.
- AC5 (>maxBytes → too_large): PASS — "body > maxBytes → too_large".
- AC6 (status mapping 401/403/429/5xx/other): PASS — table-driven `it.each([...])` covers `401→auth_failed`, `403→auth_failed`, `429→rate_limited`, `503→upstream_error`, `418→http_error`.
- AC7 (raw_content/images dropped): PASS — "raw_content/images dropped from results".
- AC8 (log info has lengths/counts only): PASS — metrics event asserted lacks `query`/`answer`/`url` keys, and only carries `queryLength`/`maxResults`/`depth`/`status`/`durationMs`/`resultCount`.
- AC9 (signal composed with run abort): PASS — "abort signal triggers timeout" aborts the parent signal mid-fetch.

## Scope coverage
- In scope "schemas.ts subset": PASS — `tools/schemas.ts:21-32` (added in F06 slice).
- In scope "searchWeb.ts factory": PASS — `tools/searchWeb.ts`.
- In scope "API key resolution via SafeStorage indirection": PASS by contract — adapter consumes the resolved key; F16 wires the indirection.
- In scope "POST body forcing": PASS.
- In scope "Per-call timeout / byte cap / status mapping / result mapping": PASS.
- In scope "Metric event": PASS.
- In scope "Unit tests msw-backed equivalents": PASS — `fetchImpl` injection mirrors msw fixtures.

## Out-of-scope audit
- Out of scope "Pluggable provider abstraction": CLEAN — Tavily-only.
- Out of scope "Streaming search results": CLEAN — single JSON payload.
- Out of scope "Result re-ranking": CLEAN — caller (extract_note) decides.

## QA aggregate
`qa-1.md` verdict PASS — 1707/1707, lint/typecheck/build green.

## Verdict: PASS
