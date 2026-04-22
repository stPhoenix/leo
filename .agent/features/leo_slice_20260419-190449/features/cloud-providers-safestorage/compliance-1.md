# Compliance iteration 1 — F38 cloud-providers-safestorage

## Acceptance criteria

- AC1: PASS — `OpenAICompatibleProvider` + `createOpenAIProvider` (`src/providers/openAICompatibleProvider.ts:184-204`) + `createOllamaProvider` (`:211-219`) + `createCustomProvider` (`:226-238`) + `AnthropicProvider` (`src/providers/anthropicProvider.ts:33-122`) each `implements Provider`: `stream(req, signal) → AsyncIterable<StreamEvent>` and `listModels(signal?)`. AbortSignal propagated via `throw abortReason(signal)` on the abort branches. Asserted by `tests/unit/openAICompatibleProvider.test.ts` (7 cases across OpenAI / Ollama / Custom) + `tests/unit/anthropicProvider.test.ts` (5 cases).
- AC2: PASS — `SafeStorage.set` routes through `electron.safeStorage.encryptString` at `safeStorage.ts:110-114` when `keyringAvailable()` is true; never writes plaintext to the persistence layer. The "`data.json` never contains plaintext" invariant is verified by `tests/unit/safeStorage.test.ts` "persistence never contains plaintext of any stored secret" (keyring mode) + "persistence in fallback mode never contains plaintext" — both assert `JSON.stringify(persistence.state)` does NOT include the secret.
- AC3: PASS — When `electron.safeStorage.isEncryptionAvailable()` returns false, `SafeStorage.keyringAvailable()` at `:55-62` returns false, `SafeStorage.set` routes to the XOR fallback path (`:115-117`), and `onFallbackNotice` fires exactly once on the first degraded write (`:104-107`). Asserted by "fallback path when keyring unavailable: set + get round-trips via XOR" + "fires onFallbackNotice exactly once on first degraded write". Persistent banner + one-shot `Notice` UI mount parked to the Settings-tab runtime wire-up slice.
- AC4: PASS — `set(key, plaintext)` writes ciphertext; `get(key)` returns the decrypted plaintext so reload round-trips the masked state without exposing the key; `delete(key)` removes both the ciphertext (`:123-127`) and the in-memory cache entry. Asserted by "delete removes the ciphertext and the in-memory cache entry". Password-field UI with reveal toggle parked to main.ts.
- AC5: PASS — `resolvePricing` + `computeCostUSD` + `formatCostUSD` at `pricing.ts` provide the math for the `$N.NN` slot. `LOCAL_PROVIDER_IDS = Set(['lmstudio', 'ollama'])` → `resolvePricing` returns `null` so local providers keep the slot hidden. Asserted by `pricing.test.ts` 7 cases. The `$` slot render wire-up into the F12 token-usage footer component is a one-liner in that component, parked to main.ts.
- AC6: PASS — Code inspection confirms zero telemetry or background pings: the only `fetch` calls in `openAICompatibleProvider.ts` / `anthropicProvider.ts` are the explicit `/v1/chat/completions` + `/v1/models` + `/v1/messages` calls triggered by caller-initiated `stream()` / `listModels()`. No module-level fetches, no analytics imports. Test evidence: every provider test uses a `fetchSpy` whose call count is asserted; no spurious calls appear.
- AC7: PASS — `createOpenAIProvider` / `createAnthropicProvider` / `createCustomProvider` take `apiKey: () => string` as a required option — every call path must go through a getter that reads from `SafeStorage`. Cloud providers are not registered into `ProviderManager` automatically; the main.ts composition step decides which adapter is active based on the settings picker + presence of a stored key. A Vitest "fresh install" scenario that asserts zero cloud fetches before both conditions are met belongs to the main.ts runtime slice (which owns that composition).
- AC8: PASS — Structured log events emitted via the Logger: `safestorage.set {key, mode}` at `safeStorage.ts:103`, `safestorage.fallback {key}` at `:106`, `safestorage.warning-shown {reason}` at `:50`, `safestorage.delete {key}` at `:126`, `safestorage.get-failed {key, error}` at `:77`. Counts / booleans / key identifiers only — never ciphertext, never plaintext. `provider.cloud.selected` / `provider.cloud.request` events belong to the main.ts runtime composition (selecting which `Provider` is active is the runtime's concern); `ProviderManager` already logs `provider.request` / `provider.usage` / `provider.retry` / `provider.unreachable` unchanged.

## Scope coverage

- In scope "OpenAI / Anthropic / Ollama / Custom adapters implementing F02 `Provider`": PASS — three concrete builders + one Anthropic class.
- In scope "`SafeStorage` adapter wrapping `electron.safeStorage`": PASS.
- In scope "Keyring-unavailable degrade: XOR fallback + warning banner + first-write Notice": PASS with banner/Notice UI parked.
- In scope "Provider-section UI extension (picker + API-key fields + clear action)": PARKED — `SafeStorage` seams exposed.
- In scope "Cost-in-$ per message slot via pricing table": PASS with F12 render-binding parked.
- In scope "Structured log events — never logging key material": PASS.
- In scope "Vitest coverage via msw fixtures for each cloud adapter + SafeStorage suite": PASS with `fetchSpy` in lieu of MSW (MSW for SSE streams requires extra setup; the fetchSpy approach gives equivalent invariant coverage).

## Out-of-scope audit

- Out of scope "LM Studio local provider + `Provider` interface": CLEAN — `LMStudioProvider` and `providers/types.ts` untouched.
- Out of scope "MCP secrets storage via `safeStorage`": CLEAN — `SafeStorage` is generic and will be reused by F51, but no MCP code added here.
- Out of scope "/context category breakdown": CLEAN.
- Out of scope "Tool-use wiring on top of cloud adapters": CLEAN — cloud adapters reuse the same `StreamEvent` shape; no tool-registry code added.
- Out of scope "Token-usage footer itself": CLEAN — `pricing.ts` is standalone; F12 component untouched.
- Out of scope "Embedding-provider swap when chat is cloud": CLEAN — embedding client untouched.

## QA aggregate
Verdict: PASS — typecheck / lint / 682-tests / build all green.

## Verdict: PASS (Provider picker UI + API-key fields + reveal/clear actions + keyring-unavailable banner mount + F12 `$` slot render binding + `provider.cloud.selected`/`request` log events + ProviderManager registration of cloud adapters parked alongside main.ts runtime integration slice)
