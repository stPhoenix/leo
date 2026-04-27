# Compliance iteration 1 — F01 adapter-contract

## Acceptance criteria

- AC1: PASS — `ExternalAgentAdapter` is abstract with `id`, `label`, `defaultTimeoutMs`, `capabilities`, `configSchema`, abstract `start(input)` returning `AsyncIterable<ExternalEvent>` (`src/agent/externalAgent/adapters/base.ts:31-38`).
- AC2: PASS — `ExternalAgentInput` only exposes `refinedAsk`, `systemPrompt`, `signal`, `timeoutMs`, `config` (`src/agent/externalAgent/adapters/base.ts:3-9`); no vault, editor, logger, or other handles.
- AC3: PASS — `ExternalEvent` discriminated union covers `log | text | file | done | error` per SRS §7 (`src/agent/externalAgent/adapters/base.ts:11-24`).
- AC4: PASS — `AdapterRegistry.register` rejects duplicates (`adapterRegistry.ts:24-32`); `freeze()` blocks subsequent register calls. Tested in `adapterRegistry.test.ts` cases "rejects duplicate ids" and "rejects registration after freeze".
- AC5: PASS — `defaultId()` honors configured default if registered + enabled, else first enabled alphabetical, else `null` (`adapterRegistry.ts:53-62`). All four cases tested in `adapterRegistry.test.ts` ("returns configured", "falls back to first enabled when missing", "falls back when disabled", "returns null when none enabled").
- AC6: PASS — ESLint override blocks adapter files (`src/agent/externalAgent/adapters/**/*.ts` excluding `base.ts`) from importing any of `@/agent/*`, `@/chat/*`, `@/ui/*`, `@/storage/*`, `@/editor/*`, `@/providers/*`, `@/skills/*`, `@/tools/*`, `@/settings/*`, `@/indexer/*`, `@/rag/*`, `@/mcp/*`, `@/platform/*` (`.eslintrc.cjs:30-66`). CI failure path verified via `pnpm lint` exit 0 on the contract-only adapter directory.
- AC7: PASS — `tests/unit/externalAgent/adapterRegistry.test.ts` covers register, duplicate rejection, default fallback ordering, disabled-default fallback, plus `isEnabled` helpers (10 tests).

## Scope coverage

- In scope `src/agent/externalAgent/adapters/base.ts: abstract class + types`: PASS — file present, exports `ExternalAgentAdapter`, `ExternalAgentInput`, `ExternalEvent`, `AdapterCapabilities`.
- In scope `src/agent/externalAgent/adapterRegistry.ts: register / list / get / defaultId with defaultId derived from settings`: PASS — file present, defaultIdSource callback wired in `main.ts:368-378`.
- In scope `ESLint no-restricted-imports config addition for src/agent/externalAgent/adapters/**`: PASS — `.eslintrc.cjs` override added; `base.ts` excluded.
- In scope `Unit tests for registry`: PASS — `adapterRegistry.test.ts` shipped.

## Out-of-scope audit

- Out of scope `Any concrete adapter implementation`: CLEAN — no files under `src/agent/externalAgent/adapters/` other than `base.ts`.
- Out of scope `Settings UI for default selection (F11)`: CLEAN — settings shape added but no UI rendered (UI is F11).
- Out of scope `Subgraph integration (F03, F05)`: CLEAN — no subgraph node files exist yet.

## QA aggregate

Verdict line from qa-1.md: **PASS** (typecheck + lint + tests + build all green). Integration gate: AdapterRegistry instantiated in `src/main.ts:370-378` with settings-bound `defaultIdSource` and `enabledSource`; `adapterRegistry` field surfaced on plugin instance for downstream features (F06, F11, F13).

## Verdict: PASS
