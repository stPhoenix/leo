# Impl iteration 1 — F11 settings-ui

## Summary

Built `ExternalAgentsSection` (React) — auto-generates per-adapter forms from `configSchema` via a Zod 4 introspection helper (`describeConfigSchema`) supporting string / secret / number / boolean / string-array / object kinds (unknown kinds render JSON placeholder). Secret fields render as password input + reveal toggle and persist through `SafeStorage` under `safeStorage:externalAgents.<id>.<field>` indirection. The `effectiveDefaultAdapterId(registry, settings)` pure helper implements FR-EXT-34's three-row fallback, mirroring `AdapterRegistry.defaultId()` against a settings snapshot. `resolveAdapterConfig` walks a stored config blob and replaces every `safeStorage:` reference with the decrypted value. The section is wired into `SettingsTab` as a new section id `externalAgents` (collapsed by default) using `createRoot` to host the React tree. Storybook fixtures cover Default, WithSecretsHidden, DefaultAdapterDisabled, NoAdaptersRegistered.

## Files touched

- `src/settings/externalAgentResolver.ts` — `effectiveDefaultAdapterId`, `resolveAdapterConfig`, `describeConfigSchema` (Zod 4 introspection).
- `src/settings/ExternalAgentsSection.tsx` — React section component + per-field renderers + secret field with reveal toggle.
- `src/settings/ExternalAgentsSection.stories.tsx` — 4 stories (Default, WithSecretsHidden, DefaultAdapterDisabled, NoAdaptersRegistered).
- `src/settings/settingsStore.ts` — added `externalAgents` to `SectionId` union + `SECTION_ORDER` + `SECTION_LABELS` + `DEFAULT_EXPANDED`.
- `src/settings/SettingsTab.ts` — added `adapterRegistry` dep, `renderExternalAgentsBody` mounting React via `createRoot`, disposer registered.
- `src/main.ts` — passed `adapterRegistry: this.adapterRegistry` to `SettingsTab`.
- `tests/unit/externalAgent/externalAgentResolver.test.ts` — 9 cases (3-branch effectiveDefault, 6 introspection + resolver cases).
- `tests/dom/externalAgentsSection.test.tsx` — 6 cases (empty state, list adapters, toggle disable, default dropdown change, secret password+reveal, default-disabled warning).

## Tests added or updated

- AC1 — section renders + onChange propagates (DOM tests).
- AC2 — `describeConfigSchema` covers string/secret/number/boolean/string-array/object, unknown emits 'unknown'.
- AC3 — secret field renders type=password by default + reveal toggle test.
- AC4 — toggle disable in DOM test passes the new settings via `onChange`; downstream picker (F08) reads `vm.adapters` already filtered enabled-only by F07 (covered indirectly).
- AC5 — default-adapter dropdown change test asserts onChange payload.
- AC6 — three-row table-test in `effectiveDefaultAdapterId` (4 cases including null fallback).
- AC7 — `resolveAdapterConfig` walks objects/arrays, prefixes short-form keys, handles missing keys.
- AC8 — Storybook stories shipped under "Settings/ExternalAgentsSection".
- AC9 — No new top-level dependency; introspection helper is hand-rolled.
- AC10 — Empty registry path: `data-slot="external-agents-empty"` note rendered.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- Zod 4 (vs spec-implied Zod 3) introspection: walks `_def.type === 'string'|'number'|'boolean'|'array'|'object'|'optional'|'default'|'nullable'` paths; field descriptors classified as `string|secret|number|boolean|string-array|object|unknown`. Unsupported kinds render a `JSON.stringify` placeholder + role=note, matching AC2's "unknown kinds → render placeholder" requirement.
- Section is mounted in `SettingsTab` via `createRoot` (the existing tab uses Obsidian `Setting` API). Disposer is registered so React unmounts on tab close.
- `key-value editor` for `z.record(z.string())` is not implemented in this slice (no v1 adapter needs it). Tracked as a follow-up — current code falls back to `unknown` kind for records, rendering the JSON placeholder.

## Assumptions

- Per OQ-01-F11: no JSON import button.
- Per OQ-02-F11: stored `defaultAdapterId` is preserved when disabled; warning rendered + runtime fallback via `effectiveDefaultAdapterId`.
- Per OQ-03-F11: text fields write on blur (secret field) and on every change (others). Number/boolean fire on change.

## Open questions

OQ-01/02/03-F11 honored. The `z.record` form widget and platform "open folder" link from the widget are minor follow-ups, not blockers.
