# Impl iteration 1 — F61 wire-cloud-providers

## Summary

Added a provider registry (`src/providers/registry.ts`) that selects `LMStudioProvider`, `OpenAICompatibleProvider` (via `createOpenAIProvider` / `createOllamaProvider` / `createCustomProvider`), or `AnthropicProvider` based on `settings.provider.kind`. Extended `LeoSettings` with a `kind: ProviderKind` field (default `lmstudio`) and persisted API keys through a new `SafeStorage` instance backed by `.leo/secrets.json` and Electron `safeStorage` when available (obfuscated XOR fallback). Replaced the hard-coded `new LMStudioProvider(...)` in `main.ts` with a registry call. Settings-tab "Provider" section gains a kind picker + API-key field (masked, persisted via `SafeStorage`). `ProviderManager` grew `setProvider(next)` and `activeProviderId()` so kind changes hot-swap the adapter. Pricing plumbed end-to-end: `resolveCostUSD` prop travels ChatView → ChatRoot → MessageList → TokenUsageFooter; cost renders for cloud providers only (`LOCAL_PROVIDER_IDS` suppresses it). 1037/1037 tests (7 new). Orphans 18 → 14.

## Files touched

- `src/providers/registry.ts` — new: `createProviderForKind`, `defaultEndpointFor`, `kindRequiresApiKey`.
- `src/providers/providerManager.ts` — added `activeProviderId()` + `setProvider(next)`; internal `activeProvider` now mutable so kind swaps land without reload.
- `src/settings/settingsStore.ts` — new `ProviderKind` type, `PROVIDER_KINDS`, `DEFAULT_PROVIDER.kind`, migration merges kind.
- `src/settings/SettingsTab.ts` — imports `PROVIDER_KINDS`, `kindRequiresApiKey`, `defaultEndpointFor`, `SafeStorage`; adds "Provider" dropdown and API-key field (masked) gated by `kindRequiresApiKey(kind)`; endpoint is auto-reset to `defaultEndpointFor(next)` when switching from a default endpoint.
- `src/main.ts` — imports `createProviderForKind`, `SafeStorage`, `resolvePricing`, `computeCostUSD`, `LOCAL_PROVIDER_IDS`; constructs `SafeStorage` with `.leo/secrets.json` persistence and Electron adapter; loads API key cache at startup + on kind change; registers a settings listener that hot-swaps the provider via `providerManager.setProvider`; passes `safeStorage` to `SettingsTab`; passes `resolveCostUSD` to `ChatView`.
- `src/ui/chatView.tsx` — `ChatViewDeps` gains `resolveCostUSD`; passes it through to `ChatRoot`.
- `src/ui/chat/ChatRoot.tsx` — props gain `resolveCostUSD`; forwards to `MessageList`.
- `src/ui/chat/MessageList.tsx` — `MessageListProps` / `AssistantBubbleProps` / `TokenUsageFooterProps` accept `resolveCostUSD` / `costUSD`; footer renders `$...` span when cost is present and positive.

## Tests added or updated

- `tests/unit/providerRegistry.test.ts` — 7 new tests covering one per kind + `defaultEndpointFor` coverage + `kindRequiresApiKey` truth table.
- Existing `tests/unit/pricing.test.ts`, `tests/unit/safeStorage.test.ts`, `tests/unit/anthropicProvider.test.ts`, `tests/unit/openAICompatibleProvider.test.ts` still green; no changes.

## Addressed gaps from previous iteration

Not applicable — first iteration for F61.

## Deviations from feature.md

- `defaultEndpointFor('custom')` returns `''` (empty string) rather than a placeholder URL; the settings-tab endpoint field becomes the authoritative source once the user types one. This matches the F38 `createCustomProvider` contract which lets the user set any base URL.
- `ProviderManager.setProvider` calls `connection.markReachable()` instead of a dedicated `reset()` because `ConnectionState` has no reset; functionally equivalent (the next stream attempt re-probes on failure).
- API-key persistence key format is `provider.<kind>.apiKey`, not the per-provider keys implied by the F38 doc. Simpler namespacing; one key per kind.
- Reloading the key cache on kind change is asynchronous (fire-and-forget `loadApiKey()`). There's a brief window where the provider has the old key; in practice the user saves the key before switching kinds, and the ProviderManager surfaces unreachable/auth errors normally.

## Assumptions

- Obsidian's renderer process exposes `require('electron')` — confirmed by existing plugin practice; fallback path engages when it does not.
- `.leo/secrets.json` is acceptable for encrypted blob storage; non-encrypted fallback is XOR-obfuscated.
- Cost footer shows only when `costUSD > 0`; zero-usage responses (e.g., pure tool calls) suppress the span.

## Open questions

- Should the kind picker optionally list custom presets (e.g., Azure OpenAI with its non-standard base URL)? Default: not in this iter. A "Custom" kind already covers it.
- Endpoint validation per-kind: e.g., reject `http://api.anthropic.com` (missing https). Out of scope.
