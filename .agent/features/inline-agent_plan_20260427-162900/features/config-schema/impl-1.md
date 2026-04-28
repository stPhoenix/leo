# Impl iteration 1 — F02 config-schema

## Summary

Landed full Zod `inlineAgentConfigSchema` covering provider/model, temperature, system-prompt override, routing, planner, budgets, sandbox, and per-tool config (`fetchUrl`, `searchWeb`, `fileOps`); each field carries `.describe()` text and `searchWeb.apiKeyRef` is flagged `.describe('secret')` for SafeStorage indirection. Top-level description encodes the NFR-IA-01 logical-sandbox caveat. Built-in `getInlineAgentSystemPrompt()` and `resolveSystemPrompt()` modules added — host prompt prepended ahead of inline (or override). Adapter `start()` now parses config (fail-fast) then validates `providerId` against the registry whitelist before falling through to the F16 stub.

`describeConfigSchema` extended to recognize `z.enum()` (treated as `string` kind with `options: string[]`) so `routing.mode`, `searchWeb.defaultSearchDepth`, and `searchWeb.defaultTopic` render in the auto-generated settings form instead of falling through as `unknown`. Touchpoint outside the inline-agent subtree per §10.1 — additive, no behaviour change for existing adapter schemas.

## Files touched

- `src/agent/externalAgent/adapters/inlineAgent/configSchema.ts` — new: Zod schema + `DEFAULT_FETCH_URL_BLOCKLIST` + `InlineAgentConfig` type alias.
- `src/agent/externalAgent/adapters/inlineAgent/systemPrompt.ts` — new: pure `getInlineAgentSystemPrompt()`.
- `src/agent/externalAgent/adapters/inlineAgent/index.ts` — wire real schema into `configSchema`; add `resolveSystemPrompt()`; lazily parse config and validate `providerId` in `start()`; emit `invalid_config` / `invalid_provider` error events.
- `src/settings/externalAgentResolver.ts` — extend `describeConfigSchema` to classify `z.enum()` as `string` with `options: string[]`.

## Tests added or updated

- `tests/unit/externalAgent/adapters/inlineAgent/configSchema.test.ts` — covers AC1 (SRS §6 default fixture parses), defaults, AC3 temperature bounds, planner/budget bounds, AC6 caveat in description, AC7 `apiKeyRef` introspects as secret, enum field surfaces.
- `tests/unit/externalAgent/adapters/inlineAgent/systemPrompt.test.ts` — covers AC4 prepend order, override path, deterministic content, presence of tool/sandbox/termination references.
- `tests/unit/externalAgent/adapters/inlineAgent/startConfigGate.test.ts` — covers AC2 invalid providerId, AC3 temperature rejection, AC5 adapter never reads thread provider (uses only configured providerId).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- Open-question resolution: `routing.mode === 'deep'` `.describe()` notes that the classifier is skipped and planner generates from scratch; full warning text deferred to copy review.
- AC2 wording says "Invalid `providerId` (not in `providers/registry.ts`)" but the adapter cannot import `providers/registry.ts` (FR-IA-04). Implemented via DI hook `knownProviderIds: () => readonly string[]` defaulting to the literal kind list (`lmstudio|openai|anthropic|ollama|custom`). `main.ts` may pass a registry-bound closure to keep the list authoritative; the default mirrors the registry exhaustively today.

## Assumptions

- Zod v4 internal shape (`_def.type === 'enum'`, `_def.entries: Record<string,string>`) is the public contract for introspection. The change is best-effort and falls back to `unknown` if either field is missing.
- `searchWeb.apiKeyRef` defaults to the `safeStorage:` indirection path even when no key is stored — `resolveAdapterConfig` then resolves it to an empty string at runtime, which the `search_web` tool surfaces as `not_configured` (F07).

## Open questions

- Should `knownProviderIds` default be wired explicitly from `main.ts` so the list stays in sync with `PROVIDER_KINDS`? Current default is hard-coded but matches `PROVIDER_KINDS`. Defer to F16.
