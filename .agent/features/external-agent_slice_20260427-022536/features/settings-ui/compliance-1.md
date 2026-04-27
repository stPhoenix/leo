# Compliance iteration 1 — F11 settings-ui

## Acceptance criteria

- AC1: PASS — `SettingsTab.renderExternalAgentsBody` mounts the React section; `onChange` calls `store.update({ externalAgents: next })` which `Plugin.saveData()` persists. DOM tests verify state propagation.
- AC2: PASS — `describeConfigSchema` (Zod 4 introspection) covers `string|secret|number|boolean|string-array|object`; unknown kinds → `unknown` field rendered as JSON placeholder + role=note. Tested in "classifies … secret, object" + "emits unknown for unsupported kinds".
- AC3: PASS — Secret field renders `type=password`, reveal toggle flips to `text`, value writes through `safeStorage.set` and stores `safeStorage:` indirection in config. DOM test "renders secret field as password input with reveal toggle".
- AC4: PASS — Toggle `enabled=false` propagates via onChange; F08's controller already filters `vm.adapters` to enabled-only via `registry.isEnabled`. DOM test "toggle disables adapter".
- AC5: PASS — Default-adapter dropdown change updates `defaultAdapterId` on the next settings snapshot. Test "default-adapter dropdown updates settings". New runs read `effectiveDefaultAdapterId` (or `registry.defaultId()`) at start time.
- AC6: PASS — `effectiveDefaultAdapterId` covers four paths (configured+enabled, missing→fallback, disabled→fallback, none→null) tested in `externalAgentResolver.test.ts`.
- AC7: PASS — `resolveAdapterConfig` walks the config blob and replaces every `safeStorage:` reference. Tested for short-form, long-form, nested, missing.
- AC8: PASS — Stories shipped under "Settings/ExternalAgentsSection": Default, WithSecretsHidden, DefaultAdapterDisabled, NoAdaptersRegistered.
- AC9: PASS — Hand-rolled introspection in `externalAgentResolver.ts`; no new top-level dependency added.
- AC10: PASS — Empty registry note rendered (`data-slot="external-agents-empty"`); dropdown shows non-selectable "No adapters registered" placeholder.

## Scope coverage

- In scope `externalAgentsSection`: PASS — `ExternalAgentsSection.tsx` + helper file.
- In scope `data.json schema additions`: PASS — `externalAgents` key added in F01.
- In scope `Secret handling via SafeStorage`: PASS — `writeSecret` callback wired to `safeStorage.set`; `resolveAdapterConfig` consumes `safeStorage:` indirection at runtime.
- In scope `effectiveDefaultAdapterId helper`: PASS.
- In scope `Storybook fixtures`: PASS — 4 stories.

## Out-of-scope audit

- Out of scope `Concrete adapter implementations`: CLEAN — section is contract-only.
- Out of scope `Widget picker UI (F08)`: CLEAN.
- Out of scope `data.json migrations`: CLEAN — additive key.

## QA aggregate

PASS (typecheck + lint + tests + build all green; +15 tests). Integration gate: `ExternalAgentsSection` is mounted from `SettingsTab.renderExternalAgentsBody` (`SettingsTab.ts:188-235`); `SettingsTab` itself is constructed at `src/main.ts:627-638` with `adapterRegistry: this.adapterRegistry`. Reachable from the entry point.

## Verdict: PASS
