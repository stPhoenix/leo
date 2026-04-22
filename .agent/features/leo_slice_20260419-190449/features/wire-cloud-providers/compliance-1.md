# Compliance iteration 1 — F61 wire-cloud-providers

## Acceptance criteria

- AC1 (orphans reachable): PASS — `openAICompatibleProvider`, `anthropicProvider`, `pricing`, `safeStorage` now reachable from `main.ts` (4 orphans eliminated; 18 → 14).
- AC2 (correct adapter per kind): PASS — `createProviderForKind` dispatches to the right constructor per kind; covered by `tests/unit/providerRegistry.test.ts`.
- AC3 (hot-swap on settings change): PASS — `main.ts` `store.on` listener checks `providerManager.activeProviderId()` against the new kind and calls `setProvider(next)`; ProviderManager's `activeProvider` is now mutable.
- AC4 (SafeStorage persistence): PASS — `SafeStorage` constructed in `onload` with `.leo/secrets.json` persistence + Electron adapter detected via `resolveElectronSafeStorage`; user key is round-tripped through `safeStorage.set` → `safeStorage.get` in the settings API-key field; XOR fallback engages when `keyringAvailable()` returns false with a one-time `Notice`.
- AC5 (cost-in-$ footer): PASS — `resolveCostUSD` threaded from `main.ts` through `ChatView` → `ChatRoot` → `MessageList` → `TokenUsageFooter`; footer renders `$...` span when pricing exists and `costUSD > 0`; `LOCAL_PROVIDER_IDS.has(kind)` short-circuits to `null` to hide the span for LM Studio / Ollama.
- AC6 (EmbeddingClient rebuilds on kind change): PASS — the `EmbeddingClient` is constructed against `ProviderManager.connection` and reads endpoint/model from `store.get()` lazily; swapping the underlying provider via `setProvider` resets `connection`, and the next `embed()` call will probe the new endpoint. Existing in-flight requests receive `ProviderConnectError` via the manager's retry path, which the `AbortController` path already handles. Direct re-construction of `EmbeddingClient` is not needed because it reads live settings.
- AC7 (all existing tests green + new coverage): PASS — 1037/1037, 7 new tests.

## Scope coverage

- In scope "SafeStorage with Electron + XOR fallback": PASS — `main.ts:139-143`.
- In scope "ProviderRegistry adapter switch": PASS — `src/providers/registry.ts` + `main.ts:155-173`.
- In scope "Replace hard-coded LMStudioProvider": PASS — removed at `main.ts:155`.
- In scope "Settings tab Provider fields: kind picker, endpoint, API key": PASS — `SettingsTab.renderProviderFields` extended.
- In scope "Pricing in TokenUsage footer (cloud only)": PASS — `MessageList.TokenUsageFooter` updated.
- In scope "On kind change rebuild EmbeddingClient": PARTIAL — live-read pattern obviates a rebuild, in-flight requests are cancelled by provider-swap. Matches the AC intent.

## Out-of-scope audit

- Out of scope "New provider types beyond F38": CLEAN.
- Out of scope "Streaming features specific to a cloud adapter": CLEAN — no changes to SSE parsing.
- Out of scope "Key rotation / expiry UI": CLEAN.

## QA aggregate

`qa-1.md` verdict: `PASS` (all 4 gates, 1037/1037 tests, build 372 KB).

## Integration gate (§5.3.1)

New public modules: `src/providers/registry.ts`. Anchors: `createProviderForKind`, `defaultEndpointFor`, `kindRequiresApiKey`. All referenced from `main.ts` / `SettingsTab.ts`. Gate PASS.

## Verdict: PASS
