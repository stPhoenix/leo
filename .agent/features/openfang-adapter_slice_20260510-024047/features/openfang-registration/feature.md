# F06 — Plugin wiring + adapter registration

## Purpose

Make `OpenfangAdapter` real at runtime by constructing it during plugin load and registering it with the existing `AdapterRegistry` from F01 of the prior slice. With registration in place, the existing settings UI (F11 of the prior slice) auto-discovers it, the existing widget picker (F08 of the prior slice) lists it, and `effectiveDefaultAdapterId()` treats it as a candidate. This feature is the first time the openfang adapter affects the shipped bundle, so it carries the bundle-budget acceptance criterion.

Implements [`context.md`](../../context.md) FR-OF-25, FR-OF-26, NFR-OF-06.

## Scope

**In scope**

- Edit `src/main.ts` (or whichever module currently performs adapter wiring — verify via `git grep 'AdapterRegistry'`):
  - Add `import { OpenfangAdapter } from './agent/externalAgent/adapters/openfang';`
  - In the existing adapter-registration block (which already constructs / registers `InlineAgentAdapter`), append `registry.register(new OpenfangAdapter());` **before** `registry.freeze()`.
- Edit `src/agent/externalAgent/adapters/openfang/index.ts` (final touch from F05) to ensure `OpenfangAdapter` is exported with no constructor arguments. (Already specced in F05 acceptance #1.)
- No edits to `AdapterRegistry`, settings, or widget code: registration alone is sufficient to surface openfang in the existing UI flows.
- Ensure `data.json` shape stays additive — no migration needed since the prior slice already provisions `externalAgents.adapters[<id>]` as a free-form map.
- Bundle-size assertion: run `pnpm check:bundle` and confirm the delta vs. the previous baseline is ≤ 15 KB minified. The script (`scripts/checkBundle.mjs`) compares `main.js` against the saved baseline; bump the baseline only if the delta is within budget.
- Smoke check via the manual dev-vault flow: with openfang registered but disabled, the existing settings dropdown still works; with openfang enabled and a stub config, the widget picker shows it.
- New unit test at `tests/unit/externalAgent/adapters/openfang/registration.test.ts`:
  - Build a fresh `AdapterRegistry`, register `new OpenfangAdapter()`, freeze. Assert `registry.get('openfang')` returns the adapter, `registry.list()` includes it sorted alphabetically, `registry.isEnabled('openfang')` returns `true` under an empty `enabledSource` (default-enabled per current registry semantics).
  - Assert `registry.defaultId()` returns `'openfang'` when:
    - `defaultIdSource` returns `'openfang'`, OR
    - `defaultIdSource` returns `null` and openfang is the only registered enabled adapter (alphabetical fallback).
  - Assert `registry.defaultId()` falls back appropriately when openfang is disabled (`enabledSource` returns `{ openfang: false }`) and another mock adapter is present.

**Out of scope**

- The settings UI itself (already shipped in the prior slice — F11).
- Storybook fixtures for the openfang config block (F07).
- Deep integration test driving the registered adapter end-to-end (F08).
- Settings-resolver glue for `safeStorage:` indirection — already in place in `src/settings/externalAgentResolver.ts`.

## Acceptance criteria

1. `src/main.ts` constructs `new OpenfangAdapter()` and calls `registry.register(...)` in the existing wiring block, before `freeze()`. (FR-OF-25.)
2. After plugin load, `registry.list()` includes an entry with `id === 'openfang'` and `label === 'OpenFang (Demiurg via A2A)'`. (FR-OF-25 / FR-OF-22.)
3. `effectiveDefaultAdapterId()` (from F11 of the prior slice) returns `'openfang'` when the user picks it from the dropdown. (FR-OF-26.)
4. `effectiveDefaultAdapterId()` falls back to alphabetical-first when the configured default is openfang AND openfang is disabled — verified against an `enabledSource` returning `{ openfang: false }`.
5. Bundle-size delta: `pnpm check:bundle` reports `≤ 15 KB minified` added since the previous main-branch baseline. If a higher delta is observed, fail CI. (NFR-OF-06.)
6. Manual smoke (dev vault): the "External Agents" settings section shows the openfang block. With `apiKey` blank, saving the form surfaces a Zod validation error inline (per F11's per-field validation on blur). With a valid stub config, the block toggles cleanly between enabled/disabled.
7. The unit test in §Scope passes — registration is idempotent (no double-register if `freeze()` is called only once per plugin instance).

## Dependencies

- **F05** — `OpenfangAdapter` class with zero-arg constructor.
- Cross-doc:
  - [`context.md#fr-of-25`](../../context.md#functional-requirements)
  - [`../../../external-agent_slice_20260427-022536/features/adapter-contract/feature.md`](../../../external-agent_slice_20260427-022536/features/adapter-contract/feature.md) (registry semantics)
  - [`../../../external-agent_slice_20260427-022536/features/settings-ui/feature.md`](../../../external-agent_slice_20260427-022536/features/settings-ui/feature.md) (`effectiveDefaultAdapterId`, `resolveAdapterConfig`)
  - [`../openfang-adapter/feature.md`](../openfang-adapter/feature.md)

## Implementation notes

- Plugin wiring conventions — see [`.agent/architecture/architecture.md`](../../../../architecture/architecture.md) §3 (plugin entry / registry pattern) and the existing `InlineAgentAdapter` registration call as a precedent.
- Registry semantics (`register` / `freeze` / `defaultId`) — see `src/agent/externalAgent/adapterRegistry.ts` (in-tree).
- Bundle-size guard — see `scripts/checkBundle.mjs` and [`.agent/standards/project-structure.md`](../../../../standards/project-structure.md) §"Test suites".
- Bundle budget — see [`.agent/standards/tech-stack.md`](../../../../standards/tech-stack.md) §"Bundle Budget" and the prior slice's [`../../../external-agent_slice_20260427-022536/features/logging-bundle/feature.md`](../../../external-agent_slice_20260427-022536/features/logging-bundle/feature.md).

## Open questions

- **OQ-01-F06** Should `OpenfangAdapter` be tree-shake-gated behind a feature flag for users who never delegate? **Proposed**: no — bundle delta target (15 KB) keeps it cheap enough to always include.
- **OQ-02-F06** Should the registration block be moved into a dedicated `src/agent/externalAgent/registerAdapters.ts` module to keep `main.ts` lean? **Proposed**: defer; if/when the third concrete adapter lands, do the extraction in that PR.
