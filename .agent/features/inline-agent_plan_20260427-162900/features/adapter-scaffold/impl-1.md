# Impl iteration 1 — F01 adapter-scaffold

## Summary

Landed the `InlineAgentAdapter` scaffold under `src/agent/externalAgent/adapters/inlineAgent/index.ts`. Defines `id`, `label`, `defaultTimeoutMs`, `capabilities`, `configSchema` (placeholder passthrough — F02 replaces), constructor `{ providerFactory, logger }`, and a stub `start()` that yields `error.code='not_implemented'` then terminates. Registered in `main.ts` after `AdapterRegistry` construction with a stub provider factory closure that throws (F16 implements). The existing `.eslintrc.cjs` adapter-isolation `no-restricted-imports` block already targets `src/agent/externalAgent/adapters/**/*.ts` so the inline-agent subtree inherits without changes.

## Files touched

- `src/agent/externalAgent/adapters/inlineAgent/index.ts` — new: `InlineAgentAdapter` class + `ProviderFactory` / `InlineAgentLogger` types.
- `src/main.ts` — import `InlineAgentAdapter`; build stub `providerFactory`; register adapter with `adapterRegistry`.

## Tests added or updated

- `tests/unit/externalAgent/adapters/inlineAgent/scaffold.test.ts` — covers: (AC1) identity/capabilities; (AC4) registry registration; (AC5) stub `start()` yields `not_implemented` and terminates; (FR-IA-48) `start()` never throws synchronously; (AC2/FR-IA-04) static-source grep verifies no forbidden imports.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

None.

## Assumptions

- Existing `.eslintrc.cjs` `no-restricted-imports` block on `src/agent/externalAgent/adapters/**/*.ts` already covers the new subtree, so no eslint edit is required for F01. The block currently restricts `@/storage/*` entirely — F07 (search_web with SafeStorage indirection) will need to relax this for `@/storage/safeStorage` only.
- The `providerFactory` closure may remain a stub for F01; F16 will materialize the closure into a real `ChatOpenAI` / `ChatAnthropic` factory.

## Open questions

- None blocking F01.
