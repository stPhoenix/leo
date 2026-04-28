# Impl iteration 1 — F01 adapter-contract

## Summary

Created the `ExternalAgentAdapter` abstract class + `ExternalEvent` / `ExternalAgentInput` types, and the `AdapterRegistry` with register / freeze / list (alphabetical) / get / defaultId / isEnabled. Wired an ESLint `no-restricted-imports` override that blocks adapter implementations under `src/agent/externalAgent/adapters/**` from pulling in runtime plugin layers (`@/agent/*`, `@/chat/*`, `@/ui/*`, `@/storage/*`, `@/editor/*`, `@/providers/*`, `@/skills/*`, `@/tools/*`, `@/settings/*`, `@/indexer/*`, `@/rag/*`, `@/mcp/*`, `@/platform/*`); base.ts is exempted from the rule. Added a Vitest unit suite covering register, duplicate rejection, freeze, alphabetical list, and the four `defaultId` fallback paths plus `isEnabled` semantics.

## Files touched

- `src/agent/externalAgent/adapters/base.ts` — abstract class + types (FR-EXT-28, FR-EXT-31).
- `src/agent/externalAgent/adapterRegistry.ts` — registry (FR-EXT-29, FR-EXT-34).
- `.eslintrc.cjs` — adapter import-restriction override (NFR-EXT-02 / C-05).
- `tests/unit/externalAgent/adapterRegistry.test.ts` — registry unit suite (AC7).

## Tests added or updated

- `tests/unit/externalAgent/adapterRegistry.test.ts` — covers AC4 (duplicate rejection + freeze), AC5 (defaultId four cases), and `isEnabled` invariants used by AC5.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- Registry exposes `register / list / get / defaultId / isEnabled / freeze / size`. The spec listed `register / list / get / defaultId` (AC4 / AC5); `isEnabled` is a small helper used by `defaultId` (and reused by F11) — surfaced because `defaultId` semantics in AC5 require checking the `enabled` flag for the configured default before fallback.
- `defaultIdSource` and `enabledSource` are constructor callbacks rather than direct settings reads — the registry stays Agent-layer with no `@/settings/*` import (per architecture compliance). Settings (F11) wires the callbacks at plugin load.

## Assumptions

- Adapter `enabled` map default semantics: a missing entry is treated as enabled (default-on) so a freshly-registered adapter is usable before settings UI ever stores a flag. F11 will toggle this explicitly.
- `freeze()` is opt-in (called by `main.ts` after all built-in adapters register). Tests register-then-freeze; hot-reload during dev does not need to re-freeze.

## Open questions

OQ-01-F01 / OQ-02-F01 in feature.md remain open; neither blocks F01 ship and both proposals are honored: secret metadata via Zod `.describe('secret')` (consumed by F11), and adapters emit `log` events instead of receiving a logger (already enforced by the input shape).
