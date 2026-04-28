# F07 — `search_web` Tavily tool

## Purpose

Build the `search_web` tool factory backed by Tavily (`https://api.tavily.com/search`). Forces `include_raw_content` and `include_images` to `false` for v1, reads the API key via `apiKeyRef` SafeStorage indirection, caps response payloads, maps HTTP error classes to typed errors, and emits non-payload `log info` per call. Skips the tool entirely when `enabled: false`. Covers FR-IA-17, FR-IA-18, FR-IA-19, FR-IA-20, FR-IA-21, FR-IA-22, FR-IA-23.

## Scope

In scope:
- `src/agent/externalAgent/adapters/inlineAgent/tools/schemas.ts` (subset for search_web): inputs `query (1..400)`, `maxResults (1..20)`, `searchDepth ('basic'|'advanced')`, `topic ('general'|'news')`, `includeAnswer`, `includeDomains (≤32)`, `excludeDomains (≤32)` per [context.md#fr-ia-17](../../context.md#functional-requirements).
- `src/agent/externalAgent/adapters/inlineAgent/tools/searchWeb.ts` exporting `createSearchWebTool({ config, signal, logger, runState })`.
- API-key resolution via existing `safeStorage:` indirection walked by [`src/settings/externalAgentResolver.ts`](../../../../src/settings/externalAgentResolver.ts) `resolveAdapterConfig` → adapter receives plaintext key in `config.tools.searchWeb.apiKey` after resolution; missing/decrypt-failure → `not_configured` + one-shot `warn`.
- POST body = `{ api_key, query, search_depth, max_results, topic, include_answer, include_raw_content: false, include_images: false, include_domains, exclude_domains }`.
- Per-call `timeoutMs` default 20 s; response body cap default 256 KB; over-cap → `error: 'too_large'`.
- Status-class mapping: `401|403 → 'auth_failed'`, `429 → 'rate_limited'`, `5xx → 'upstream_error'`, other non-2xx → `'http_error'` + `status`.
- Result mapping drops `raw_content` + `images` even if present; output shape per [context.md#fr-ia-20](../../context.md#functional-requirements).
- Tool omitted from agent's tool list when `enabled === false` (config drives this — F11/F12/F14 read `tools.searchWeb.enabled`).
- One `log info` per call with `{queryLength, maxResults, depth, status, durationMs, resultCount}` only; `query` redacted to length per [F05](../event-bridge/feature.md) elision.
- Unit tests (msw-backed): success path mapping, missing key warn-once, 401 → auth_failed, 429 → rate_limited, 503 → upstream_error, oversize body → too_large, query elision in `info` log, full payload only at `debug`.

Out of scope:
- Pluggable provider abstraction for non-Tavily search (deferred per [context.md#out-of-scope](../../context.md#out-of-scope)).
- Streaming search results — Tavily returns one JSON payload.
- Result re-ranking inside the tool (caller decides relevance via `extract_note`).

## Acceptance criteria

1. Inputs Zod-validated; query length 1..400 enforced ([context.md#fr-ia-17](../../context.md#functional-requirements)).
2. `enabled: true` + missing `apiKeyRef` → `{ ok: false, error: 'not_configured' }` and a one-shot `log warn` per run ([context.md#fr-ia-21](../../context.md#functional-requirements)).
3. `enabled: false` → tool omitted from the agent's tool list entirely ([context.md#fr-ia-21](../../context.md#functional-requirements)).
4. POST body contains `include_raw_content: false`, `include_images: false` regardless of upstream config ([context.md#fr-ia-18](../../context.md#functional-requirements)).
5. Response > 256 KB → `{ ok: false, error: 'too_large' }` ([context.md#fr-ia-19](../../context.md#functional-requirements)).
6. Status-class mapping per [context.md#fr-ia-23](../../context.md#functional-requirements) — verified by 401/403/429/503/418 fixtures.
7. Result `raw_content` and `images` dropped before returning ([context.md#fr-ia-20](../../context.md#functional-requirements)).
8. `log info` event carries lengths/counts only; raw `query`, `answer`, `urls`, `content` never logged at `info` ([context.md#fr-ia-22](../../context.md#functional-requirements)).
9. Per-call `signal` composed with run abort — verified by abort firing during in-flight fetch.

## Dependencies

- [F05 — event bridge](../event-bridge/feature.md) (elision + log mapping).
- [F02 — config schema](../config-schema/feature.md) (`tools.searchWeb` shape, including `apiKeyRef`).
- [`src/storage/safeStorage.ts`](../../../../src/storage/safeStorage.ts) — only `safeStorage` import permitted under adapter-isolation rule (whitelist exception per F01).
- [`src/settings/externalAgentResolver.ts`](../../../../src/settings/externalAgentResolver.ts) — already walks `safeStorage:` indirection.
- [context.md#fr-ia-17](../../context.md#functional-requirements)..FR-IA-23.

## Implementation notes

- Zod-first tool boundary + `.describe()`: [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) §"Zod & Tool Schemas".
- Status-class mapping pattern echoes [`src/providers/openAICompatibleProvider.ts`](../../../../src/providers/openAICompatibleProvider.ts) error normalization — review for parity but do **not** import (FR-IA-04 isolation rule).
- SafeStorage indirection contract documented at [.agent/srs/external-agent.md](../../../../.agent/srs/external-agent.md) §11 (per [context.md#scope](../../context.md#scope)).
- Best-practices: timeouts + structured logs around external calls ([`.agent/standards/best-practices.md`](../../../../.agent/standards/best-practices.md) §"Operational Excellence").

## Open questions

- Tavily auth-failure body shape — does the API surface a structured error JSON we should preserve in `details`? Capture during msw fixture creation (F18).
- Should we emit a one-shot `log warn` only on the first `not_configured` per run, or every call? SRS says "one-shot per run" — implement with a per-instance flag.
- Domain count cap (≤32) — Tavily's documented cap may differ. Verify and clamp to whichever is lower.
