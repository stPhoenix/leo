# F11 — Settings UI section + per-adapter config

## Purpose

Surface adapter administration in the existing `SettingsTab`: pick the global default adapter, toggle individual adapters on/off, and edit each adapter's config (declared via its `configSchema`). Secret fields persist via `SafeStorage`. The widget picker (F08) sources its list from this state.

Implements [`context.md`](../../context.md) FR-EXT-30, FR-EXT-33, FR-EXT-34.

## Scope

**In scope**
- `src/settings/externalAgentsSection.ts`: a self-contained `SettingsTab` section that, given the `AdapterRegistry`, renders:
  - Section header "External Agents" with one-paragraph description.
  - Global-default dropdown listing all *enabled* registered adapters (label = `adapter.label`, value = `adapter.id`). Default-selected = current value of `externalAgents.defaultAdapterId`. Disabled state appears as a clarifying note rather than the dropdown.
  - For each registered adapter: a collapsible block with `enabled` toggle + auto-generated form from `configSchema`. Field types map: `z.string()` → text input; `z.string().describe('secret')` → password input + SafeStorage; `z.number()` → number input; `z.boolean()` → checkbox; `z.array(z.string())` → comma-separated text input; `z.record(z.string())` → key-value editor; `z.object(...)` → nested fieldset.
- `data.json` schema additions under `externalAgents`:
  ```json
  {
    "defaultAdapterId": "claude-code",
    "adapters": {
      "<id>": { "enabled": true, "config": { ...adapter-specific... } }
    }
  }
  ```
- Secret handling: any field with `.describe('secret')` is stored under `safeStorage:externalAgents.<id>.<fieldPath>` (existing `safeStorage` indirection convention) and rendered as a password input; reveal button toggles plain-text view.
- Resolution path: a small helper `resolveAdapterConfig(id): Promise<unknown>` reads stored config, replaces every `safeStorage:` reference with the decrypted value, and returns the resolved object. Called by F05 via the `Settings` injected dep before invoking `adapter.start()` — so adapters never see the indirection (matches F10 §Scope note).
- `effectiveDefaultAdapterId(registry, settings): string | null` helper implementing FR-EXT-34 fallback (configured default if registered + enabled, else alphabetically-first enabled, else `null`).
- Storybook fixtures for the section component shell, using `MockAdapter` stubs from F03's test harness (concrete adapters are out of v1 — Storybook must demonstrate the section works against arbitrary adapters via the contract): `Default` (two mock adapters), `WithSecretsHidden`, `WithSecretsRevealed`, `DefaultAdapterDisabled`, `NoAdaptersRegistered` (empty registry — must show the empty-state with a helpful note).

**Out of scope**
- Concrete adapter implementations (deferred from v1; the section only knows the contract).
- The widget picker UI (F08; consumes state via controller).
- Migrations of existing `data.json` (no prior shape under `externalAgents`; adding the key is additive — empty default safely treated as "no overrides").

## Acceptance criteria

1. Section renders inside `SettingsTab` and saves changes via `Plugin.saveData()`. Persisted shape matches §Scope schema.
2. Form auto-generation from `configSchema` covers Zod kinds listed in §Scope. Unknown kinds → render a read-only `JSON.stringify` placeholder + log `warn` (no hard fail).
3. Secret fields:
   - Stored under `safeStorage:` indirection.
   - Rendered as password input (`type=password`) with reveal toggle.
   - Plaintext value never appears in `data.json`.
   Honors Constraint **C-09**.
4. `enabled` toggle for an adapter immediately removes it from the widget picker (F08) — verified by an integration test that mounts F08 and toggles `enabled=false` in the test settings store.
5. Default-adapter dropdown changes `externalAgents.defaultAdapterId`. New widget instances created after the change pick up the new default.
6. `effectiveDefaultAdapterId()` returns:
   - the configured id if it's registered AND enabled;
   - else the alphabetically-first enabled adapter's id;
   - else `null`.
   Three-row table-test covers all branches. Honors FR-EXT-34.
7. `resolveAdapterConfig(id)` resolves all `safeStorage:` references; raw indirection strings never reach `adapter.start()`. Honors FR-EXT-30 + Constraint **C-09**.
8. Storybook stories listed in §Scope render under "settings/ExternalAgentsSection". Honors Constraint **C-06** ("don't forget storybooks").
9. No new top-level dependency added; form auto-generator is hand-rolled per [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §"Zod & Tool Schemas". Honors NFR-EXT-06.
10. **Empty-registry behavior** (concrete adapters deferred from v1): the section header still renders; the dropdown shows a single non-selectable placeholder ("No adapters registered"); per-adapter blocks list is empty with a one-paragraph note explaining the deferral and pointing to the SRS Out-of-scope section. The widget (F08) handles the same empty-state with its own picker copy.

## Dependencies

- **F01** — `AdapterRegistry`, `configSchema` discipline. (Concrete adapters F09 / F10 were dropped from the v1 plan; settings section operates against the contract only and renders an empty state when no adapters are registered. Storybook fixtures use F03's `MockAdapter` test stub.)
- Cross-doc:
  - [`context.md#fr-ext-30`](../../context.md#functional-requirements)
  - [`context.md#constraints`](../../context.md#constraints) **C-06**, **C-09**
  - [`../adapter-contract/feature.md`](../adapter-contract/feature.md)

## Implementation notes

- `SettingsTab` integration — extend the existing `src/settings/SettingsTab.ts`; pattern documented at [`.agent/architecture/architecture.md`](../../../../architecture/architecture.md) §3.1 (UI Layer table) and §3.4 (`SafeStorage` adapter).
- Zod-driven form rendering — keep auto-generator in `externalAgentsSection.ts` to avoid leaking a generic form lib into `main.js`; per [`.agent/standards/tech-stack.md`](../../../../standards/tech-stack.md) §"Bundle Budget".
- `SafeStorage` API — see existing `src/storage/safeStorage.ts` and [`.agent/architecture/architecture.md`](../../../../architecture/architecture.md) §3.4.
- Plugin data persistence — `loadData` / `saveData` per [`.agent/standards/tech-stack.md`](../../../../standards/tech-stack.md) §"Platform APIs".
- Storybook stories pattern — `*.stories.tsx` colocated; existing examples under `src/ui/chat/` per [`.agent/standards/project-structure.md`](../../../../standards/project-structure.md).

## Open questions

- **OQ-01-F11** Should the section support importing a config blob (JSON) for batch setup of multiple adapters? **Proposed**: no for v1; cosmetic enhancement.
- **OQ-02-F11** When the user disables the configured default adapter, should the dropdown auto-update to the fallback, or display a warning until the user picks a new default? **Proposed**: warning + the fallback is what `effectiveDefaultAdapterId()` returns at runtime, but the stored `defaultAdapterId` is preserved (so re-enabling restores their original choice).
- **OQ-03-F11** Validation timing — on every keystroke or on blur? Affects perceived performance of complex forms. **Proposed**: on blur for text fields, immediate for toggles/dropdowns.
