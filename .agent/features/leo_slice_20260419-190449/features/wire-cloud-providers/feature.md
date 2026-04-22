# F61 — Wire cloud provider adapters + SafeStorage + pricing

## Purpose

Close the integration gap left by F38. `openAICompatibleProvider`, `anthropicProvider`, `pricing`, and `safeStorage` ship as domain modules but are not constructed, registered with `ProviderManager`, or surfaced in the settings UI. Today `main.ts` hard-codes `LMStudioProvider`; this feature wires the common provider interface so the active provider is chosen by settings, cloud keys are held in Electron `safeStorage` with an obfuscated fallback, and per-message cost-in-$ surfaces when a cloud provider is active.

## Scope

### In scope

- Construct a `SafeStorage` instance backed by Electron `safeStorage` (via `(window as any).require('electron').safeStorage` in the renderer) with the existing obfuscated `xorB64Encode` fallback when `isEncryptionAvailable()` returns false; persistence target is `.leo/secrets.json` via `VaultAdapter`.
- Build a `ProviderRegistry` (new small helper in `src/providers/registry.ts`) that returns the active provider based on `settings.provider.kind` (`lmstudio` | `openai` | `anthropic` | `ollama` | `custom`), constructing the corresponding adapter with the endpoint + API key resolved from `SafeStorage`.
- Replace the hard-coded `new LMStudioProvider` in `main.ts` with a `ProviderManager` fed from the registry, switching providers on settings change without reload.
- Settings tab "Provider" section gains: provider kind picker, endpoint field, API-key field (masked, stored via `SafeStorage`), model field, embedding-model field, and per-kind validation messages.
- `pricing.ts` `resolvePricing` + `computeCostUSD` wired into the existing `TokenUsage` footer so cost-in-$ renders next to token counts when the active provider has pricing; uses `BUNDLED_PRICING` by default, `LOCAL_PROVIDER_IDS` suppresses the $ slot.
- On provider-kind change, the `EmbeddingClient` rebuilds against the new provider; stale connection state is reset.
- Unit tests: registry returns correct adapter per kind; SafeStorage round-trips a secret through Electron + obfuscated paths; pricing computation matches the F38 numbers; cost shows in the footer for cloud kinds and is hidden for local kinds.

### Out of scope

- New provider types beyond those F38 already implements.
- Streaming features specific to a cloud adapter (Anthropic tool use, OpenAI function calling) beyond what F38 codified.
- Key rotation / expiry UI.

## Acceptance criteria

1. Orphans `providers/openAICompatibleProvider.ts`, `providers/anthropicProvider.ts`, `providers/pricing.ts`, `storage/safeStorage.ts` become reachable from `src/main.ts`; §5.4 audit removes them.
2. `settings.provider.kind === 'openai'` causes the active provider to be an `OpenAICompatibleProvider` created by the registry; likewise for `anthropic` (→ `AnthropicProvider`), `ollama` (→ Ollama OpenAI-compat), `custom` (→ `OpenAICompatibleProvider` with user-supplied endpoint), `lmstudio` (→ `LMStudioProvider`).
3. Changing `provider.kind` in settings swaps the live provider without an Obsidian reload; the `ProviderManager.connection` state resets and the status bar reflects the new provider.
4. Cloud API keys are stored through `SafeStorage`: a key entered in settings is encrypted via Electron `safeStorage` when available, or XOR-obfuscated when not; the raw key never touches plugin `data.json`.
5. Per-message `TokenUsage` footer renders cost-in-$ (e.g., `$0.0023`) when the active provider is in `BUNDLED_PRICING` and `usage` is present; footer hides the $ slot for `LOCAL_PROVIDER_IDS`.
6. The `EmbeddingClient` is rebuilt with the new provider on kind change; any in-flight embedding request is cancelled.
7. All existing tests stay green; new tests added per §Scope.

## Dependencies

F01 (Logger) · F02 (LMStudio provider + manager) · F03 (settings scaffold) · F07 (TokenUsage footer) · F38 (cloud adapters). All `feature-complete`.

## Implementation notes

- [Architecture §3.4 Adapters — Providers](../../../../architecture/architecture.md#34-adapters) — all provider adapters conform to the `ChatProvider` interface; the registry dispatches by kind.
- [Tech stack — Secrets](../../../../standards/tech-stack.md#storage-layout) — `safeStorage` with obfuscated fallback is the prescribed key store.
- [Code style — Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) — settings mutate via `store.update(...)`; providers swap reactively via `settings.subscribe`.
- F38 compliance-1 calls out "Provider-section UI + $-slot wire-up + cloud-registration parked to main.ts" — this feature delivers exactly that.

## Open questions

- Registry injection: plain function vs small class? Default: plain factory `createProvider(kind, opts)` returning `ChatProvider`. Simpler, easier to test.
- Where does the obfuscated-fallback warning surface? Default: a one-time `Notice` on load if `isEncryptionAvailable()` returns false.
