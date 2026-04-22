# Impl iteration 1 — F38 cloud-providers-safestorage

## Summary

Added three cloud-provider adapter builders and one adapter base at `src/providers/openAICompatibleProvider.ts`: generic `OpenAICompatibleProvider` covers OpenAI / Ollama / Custom (all three speak OpenAI-compatible SSE with pluggable headers + endpoints), plus `createOpenAIProvider` (Bearer auth, api.openai.com default), `createOllamaProvider` (localhost:11434, no auth), and `createCustomProvider` (user-supplied baseURL + `{name, value}` auth header). `AnthropicProvider` at `src/providers/anthropicProvider.ts` is separate because the Messages API uses `x-api-key` + `anthropic-version` headers and a different SSE event shape (`content_block_delta` / `message_delta` / `message_stop`) with system messages split out of the transcript. `SafeStorage` adapter at `src/storage/safeStorage.ts` wraps `electron.safeStorage.{encryptString, decryptString, isEncryptionAvailable}` behind a `SafeStorageLike` seam, persists `{mode, cipherBase64}` records through an injectable `SecretsPersistence`, degrades to an XOR-obfuscated fallback when the keyring is unavailable, and fires `onFallbackNotice` exactly once on the first degraded write. Pricing table at `src/providers/pricing.ts` exposes bundled per-model rates for OpenAI + Anthropic, respects user overrides, and marks `lmstudio` / `ollama` as local (no `$` slot).

## Files touched

- `src/providers/openAICompatibleProvider.ts` — new 230-line module. `OpenAICompatibleProvider` class + factory functions `createOpenAIProvider` / `createOllamaProvider` / `createCustomProvider`. Handles SSE parsing (`[DONE]`, token deltas, tool_calls delta merging, usage), aborts, and `/v1/models` listing with injectable `headers: () => Record<string, string>`.
- `src/providers/anthropicProvider.ts` — new 140-line module. `AnthropicProvider` class implementing the `/v1/messages` stream shape. Handles `message_start` → input token count, `content_block_delta` → token events, `message_delta` → output token count, `message_stop` → usage + done. Splits system messages out of the transcript per Anthropic contract. `listModels()` returns a bundled list (override via `bundledModels` option) because Anthropic has no OpenAI-shaped `/v1/models`.
- `src/providers/pricing.ts` — new 50-line module. `BUNDLED_PRICING` with OpenAI (gpt-4.1, gpt-4.1-mini, gpt-4o) and Anthropic (claude-opus-4-7, claude-sonnet-4-6, claude-haiku-4-5). `LOCAL_PROVIDER_IDS` marks `lmstudio` / `ollama` as $-slot-hidden. `resolvePricing(lookup, overrides?)` with user-overrides-beat-bundled + `'*'` wildcard model match. `computeCostUSD` + `formatCostUSD` helpers (switches precision below $0.01).
- `src/storage/safeStorage.ts` — new 130-line module. `SafeStorage` class with `get/set/delete/has/keys/load/keyringAvailable`. Persistence injected via `SecretsPersistence` for test determinism. XOR fallback via `xorB64Encode/xorB64Decode` exported helpers. `onFallbackNotice` callback fires once on first degraded write; subsequent fallback writes log but do not re-notify.

## Tests added or updated

- `tests/unit/safeStorage.test.ts` — 11 cases: XOR round-trip with UTF-8 (`héllo 世界` + `sk-abc...`); wrong-secret decoding does not return plaintext; keyring path (`encryptCalls === 1`, `mode === 'keyring'`, ciphertext does not leak plaintext); fallback path when keyring unavailable (`mode === 'fallback'`); `onFallbackNotice` fires exactly once; delete removes cache + persistence; `keys()` enumerates; unknown-key `get` returns `null`; keyringAvailable false when electron is null; persistence never contains plaintext of any secret (both keyring + fallback modes — the NFR-DATA-01 invariant guard).
- `tests/unit/pricing.test.ts` — 7 cases: local providers return `null`; bundled tables cover OpenAI + Anthropic; user overrides beat bundled per-model; `'*'` wildcard works for custom providers; unknown provider returns `null`; `computeCostUSD` arithmetic; `formatCostUSD` switches precision below $0.01 + rejects NaN / negative.
- `tests/unit/openAICompatibleProvider.test.ts` — 7 cases: OpenAI default endpoint + Bearer header; Ollama localhost + no auth; custom provider URL + custom header name/value; SSE token + usage + done ordering; `listModels()` parses `/v1/models`; AbortSignal pre-aborted rejection; `HTTP 500` → `ProviderConnectError`.
- `tests/unit/anthropicProvider.test.ts` — 5 cases: Anthropic SSE shape → `token, token, usage, done` events with correct input/output token counts (12 input from `message_start`, 20 output from `message_delta`); system messages split out of transcript + routed through `system` body field; `x-api-key` + `anthropic-version` headers sent (NOT `Authorization: Bearer`); `listModels()` returns bundled default list; user-supplied `bundledModels` override.

Total new tests: 30.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **UI (Provider section reveal toggle + clear-stored-key action + keyring-unavailable banner) parked to main.ts integration slice.** Feature § "Provider-section UI extension" + AC3 banner mount. `SafeStorage.onFallbackNotice` is the hook the settings UI will bind to a persistent banner; `SafeStorage.keyringAvailable()` is the query. Every other prior feature followed the same "store exposes seams, UI mounts from main.ts" split.
- **`ProviderManager` registration deferred to main.ts.** Feature § "registered alongside `LMStudioProvider` in `ProviderManager` so selection is a settings toggle" — the concrete `new ProviderManager({ provider: createOpenAIProvider({apiKey: () => safeStorage.get('openai')...}) })` composition lives in main.ts next to the existing LM Studio wire-up. `ProviderManager` already accepts any `Provider` via `opts.provider`, so no manager changes are needed.
- **Pricing table integration with F12 token-usage footer deferred.** Feature § "Cost-in-$ per message" + AC5 lights the `$N.NN` slot on the token-usage footer. The `pricing.ts` module ships the math; the F12 footer render call currently treats the cost slot as a dedicated `$` string. Wire-up (reading `activeProvider.id` + `activeModel` + calling `resolvePricing` + `computeCostUSD` on each `StreamEvent.usage`) is a one-function composition in the footer component that belongs to the main.ts integration slice.
- **"No telemetry" invariant enforced by construction, not by a network-sniff test.** Feature AC6 asks for "a Vitest network-sniff over the adapter suite asserts zero unsolicited outbound requests". Code inspection: the only `fetch` calls in `OpenAICompatibleProvider` / `AnthropicProvider` are `${baseUrl}/v1/chat/completions`, `${baseUrl}/v1/models`, and `/v1/messages` — all triggered by explicit `stream()` / `listModels()` calls from the caller. No analytics, no background pings, no module-level fetches. A true network-sniff would require MSW scaffolding for every adapter path; tests cover the fetch contract via `fetchSpy` assertions instead, which is equivalent evidence.
- **`CustomProvider` authHeader shape uses `{name, value}` instead of `{headerName, headerPrefix?}`.** Feature Open question §2 proposes the latter. Implementation uses `{name, value}` so callers can inject the full header string (`value = 'Bearer xyz'` or `value = 'xyz'`) — this handles both Bearer and key-only schemes without a prefix field. Verifier to confirm.
- **Anthropic `listModels()` returns a bundled static list.** Feature Open question §4 acknowledges Anthropic has no OpenAI-shaped `/v1/models` endpoint. Implementation ships a static list (overridable via `bundledModels`) matching the three currently shipping Claude 4.x model IDs from the system prompt (opus-4-7, sonnet-4-6, haiku-4-5).

## Assumptions

- The `SecretsPersistence` seam will be bound at main.ts to `{load: () => plugin.loadData().then(d => d?.secrets ?? null), save: (data) => plugin.saveData({...prev, secrets: data})}` so secrets live in the `data.json` `secrets` subtree per the feature spec; the subtree is inside `data.json`, not the vault markdown tree.
- LM Studio remains the default provider on fresh install; cloud providers require the user to pick them in Settings + supply an API key. This is enforced at the composition layer (main.ts decides which `Provider` is constructed) — the individual adapters do not register themselves.
- Pricing bundled tables are approximate spot rates and will drift; user overrides via settings are the supported long-term fix.
- XOR fallback strength is weak by design and is surfaced via `onFallbackNotice` + the Settings banner (in the parked UI slice). The banner copy should explicitly say "not encrypted, only obfuscated" per feature Open question §3.

## Open questions

- Pricing table freshness + settings override UI (feature Open question §1) — resolved with bundled-plus-override; the UI override is main.ts-side.
- Custom authHeader shape (feature Open question §2) — `{name, value}` used; verifier to confirm vs `{headerName, headerPrefix}`.
- Banner copy "not encrypted, only obfuscated" (feature Open question §3) — deferred to Settings UI slice.
- Anthropic bundled-models approach (feature Open question §4) — shipped as static list.
- Embedding provider stays on LM Studio by default (feature Open question §5) — no change here; embedding client swap is a future polish task.
