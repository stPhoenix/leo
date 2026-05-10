# F07 — Storybook fixtures for openfang config block

## Purpose

Visual regression coverage for the openfang adapter's settings block. The existing `ExternalAgentsSection` (F11 of the prior slice) auto-generates form inputs from any adapter's `configSchema`, so this feature adds Storybook stories that mount a registry containing only the `OpenfangAdapter` and exercise: populated config, secret reveal/mask, validation error on a bad URL, and the disabled state. No new component code — only new stories on top of the existing fixture file.

Implements [`context.md`](../../context.md) FR-OF-23 (visual confirmation), FR-OF-24 (visual confirmation).

## Scope

**In scope**

- Edit `src/settings/ExternalAgentsSection.stories.tsx`:
  - Add a story-local helper to build a `MockAdapterRegistry` containing a single `OpenfangAdapter` instance (or a pure-config-shape adapter stub if importing `OpenfangAdapter` triggers unwanted side effects in Storybook — confirm by trying the real import first; fall back to stub only if necessary).
  - Add four new stories under the existing `settings/ExternalAgentsSection` story namespace:
    - `OpenfangConfigured` — registry contains only `OpenfangAdapter`; settings store has `{baseUrl:'https://openfang.example.com:4200', apiKey:'demo-key-redacted', sessionId:'leo-thread-001', pollTimeoutMs:1_800_000, pollInitialIntervalMs:2_000, pollMaxIntervalMs:15_000, httpTimeoutMs:30_000, allowInsecureHttp:false}`. Adapter enabled, default-selected. Visual: full config block with all fields populated; `apiKey` masked.
    - `OpenfangSecretRevealed` — same as above; secret-reveal pre-clicked so `apiKey` shows plaintext. Verifies the F11 reveal toggle works against an openfang-shaped schema.
    - `OpenfangDisabled` — adapter present but `enabled=false`. Visual: collapsed block, dropdown shows fallback warning (re-uses F11's `DefaultAdapterDisabled` mechanic but for openfang specifically).
    - `OpenfangInvalidBaseUrl` — registry + enabled, but `baseUrl='not-a-url'`. Visual: inline error under the `baseUrl` field, persistence skipped (F11 acceptance #2 + F11 §"Event flow"). Confirms the per-field validation runs against `openfangConfigSchema`.
- Story decorators: reuse the existing Obsidian theme decorator from `.storybook/preview.ts`. No new globals, no new mocks beyond the registry composition helper.
- Storybook story matrix updated in this feature.md (see §Storybook below).
- Smoke run: `pnpm storybook` — open `settings/ExternalAgentsSection` and confirm all four new stories render without console errors.

**Out of scope**

- Any change to `ExternalAgentsSection.tsx` itself — F11 is generic, openfang adds no UI code.
- Storybook for the widget picker / chat blocks — those exist in F08 of the prior slice, not affected by this feature.
- Visual regression baseline updates / screenshot-diff tooling — not part of project's Storybook setup.
- Storybook fixture for the `delegate_external` confirmation dialog — owned by F06 of the prior slice.

## Acceptance criteria

1. The four new stories are listed under `settings/ExternalAgentsSection` in `pnpm storybook` and render without React errors or console warnings beyond the project baseline.
2. `OpenfangConfigured` shows: section header, default-adapter dropdown with `openfang` selected, expanded openfang block, every field defined in `openfangConfigSchema` rendered with the right input type (text, password, text, number ×4, checkbox).
3. `OpenfangSecretRevealed` shows the `apiKey` field as plaintext (`<input type="text">`) with the reveal toggle in the active state.
4. `OpenfangDisabled` shows a fallback warning consistent with F11's `DefaultAdapterDisabled` story (re-uses the same component code path).
5. `OpenfangInvalidBaseUrl` shows the inline validation error from F11's per-field validation, sourced from `openfangConfigSchema`'s Zod error path. The persisted value remains the previous valid one (per F11 §"Event flow" non-secret-edit branch).
6. No new dependency added; new stories use existing Storybook infra and decorators per [`.agent/standards/project-structure.md`](../../../../standards/project-structure.md) §"Test suites".

## Dependencies

- **F05** — `OpenfangAdapter` (or its `configSchema` if a stub is preferred).
- Indirectly **F11 of the prior slice** — provides the section component the stories mount. Already in-tree at `src/settings/ExternalAgentsSection.tsx` and `src/settings/ExternalAgentsSection.stories.tsx`.
- Cross-doc:
  - [`context.md#fr-of-23`](../../context.md#functional-requirements), [`context.md#fr-of-24`](../../context.md#functional-requirements)
  - [`../../../external-agent_slice_20260427-022536/features/settings-ui/ui.md`](../../../external-agent_slice_20260427-022536/features/settings-ui/ui.md)
  - [`../openfang-config-schema/feature.md`](../openfang-config-schema/feature.md)
  - [`../openfang-adapter/feature.md`](../openfang-adapter/feature.md)

## Implementation notes

- Storybook conventions — colocated `*.stories.tsx`, Obsidian theme decorator from `.storybook/preview.ts`. Pattern documented in [`.agent/standards/project-structure.md`](../../../../standards/project-structure.md) §"Test suites" and used in `src/settings/ExternalAgentsSection.stories.tsx`.
- Tailwind scoping under `.leo-root` per [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §Styling.
- Mock registry shape — see the existing `MockAdapter` test stub used by F03 of the prior slice; same shape works in Storybook fixtures.
- Settings persistence shape — see [`../../../external-agent_slice_20260427-022536/features/settings-ui/feature.md`](../../../external-agent_slice_20260427-022536/features/settings-ui/feature.md) §Scope (`externalAgents.adapters[<id>]` schema).

## Open questions

- **OQ-01-F07** Should we add a fifth story `OpenfangInsecureHttpAllowed` covering the `allowInsecureHttp=true, baseUrl='http://localhost:4200'` case, with a UI hint that this is non-recommended? **Proposed**: not in v1 — the warning is visual nice-to-have; functional behavior is covered by F05 unit tests.
- **OQ-02-F07** Should the stories use the real `OpenfangAdapter` import or a pure config-shape stub to keep Storybook bundle small? **Proposed**: real import; verify Storybook bundle delta stays ≤ 5 KB. Fall back to stub if the real adapter pulls heavier modules through transitive imports (it should not — F05 imports are zod-only at module scope).
