# Impl iteration 1 — F03 settings-tab-scaffold

## Summary

Delivered Leo's single source of user-facing configuration: a versioned `SettingsStore` that migrates legacy plugin data forward into a `LeoSettings` v1 shape (logLevel + provider + ui), an Obsidian `PluginSettingTab` (`SettingsTab`) rendering all seven mandated collapsible sections in order with persisted expand state, a Provider section that swaps between a welcome empty-state CTA and live fields (endpoint URL, chat-model dropdown, embedding-model dropdown, temperature slider, max-tokens text, status line, re-probe button), an `Advanced` section that flips the F01-owned `logLevel`, an Obsidian `Modal`-hosted React 18 first-run wizard (`WizardModal` + `WizardApp`) driven by a pure-TS state machine (`wizardMachine`) that walks endpoint → probe → models → save, falling back to free-text inputs when `/v1/models` returns empty, two new commands routed through a shared `registerLeoCommand` helper so they are reachable from Obsidian's native Hotkeys UI, and 29 new tests (11 SettingsStore + 18 wizardMachine) on top of the 48 carried forward from F01/F02 — 77/77 pass.

## Files touched

- `src/settings/settingsStore.ts` — new — `LeoSettings` v1 schema, `migrate()` (defaults / legacy fallback / firstRun inference / clamp), `SettingsStore.load/get/update/on`, section ordering + labels + placeholder copy.
- `src/settings/wizardMachine.ts` — new — pure-TS reducer + `WizardState` / `WizardEvent` union driving the seven steps from `endpoint` through `closed`, with default-model inference and free-text fallback for empty model lists.
- `src/settings/SettingsTab.ts` — new — `PluginSettingTab` subclass; renders all seven collapsible sections (chevron via `setIcon`, `role=button`/`aria-expanded`/`aria-controls`, Enter/Space toggling, persisted state); Provider section conditionally renders welcome panel vs live fields; `renderProviderFields` covers endpoint/chat/embedding/temperature/maxTokens; degrades model dropdowns to free-text input when the provider is unreachable; Advanced section flips `logLevel` and re-applies it to the live `Logger`.
- `src/settings/wizardModal.tsx` — new — Obsidian `Modal` subclass that mounts a React 18 root via `createRoot` into `contentEl` and unmounts it in `onClose`; exports `makeWizardProbe` constructing a fresh `LMStudioProvider` against the user-edited endpoint so the wizard can probe before persisting.
- `src/settings/WizardApp.tsx` — new — React function-component shell wired to `wizardMachine`; useEffect-driven probe + persist side effects with cancellation guards; stepper, model pickers (dropdown / free-text), summary view, Cancel / Back / Next buttons matching ui.md wireframes.
- `src/settings/commands.ts` — new — `registerLeoCommand` thin wrapper around `Plugin.addCommand`, `COMMAND_IDS`, and `openLeoSettings` helper using Obsidian's internal `app.setting.openTabById`.
- `src/main.ts` — replaces the inline settings shape with `SettingsStore.load()`; instantiates `SettingsTab`; registers `Leo: Open settings` and `Leo: Configure LM Studio` palette commands; `LMStudioProvider` / `EmbeddingClient` now read endpoint and embedding model through the store getter so wizard saves take effect immediately.
- `.eslintrc.cjs` — adds `parserOptions.ecmaFeatures.jsx: true` so `.tsx` files lint.
- `package.json` — adds `react@^18`, `react-dom@^18` (prod) and `@types/react@^18`, `@types/react-dom@^18` (dev); the bundle still fits well under the 1.5 MB budget (production main.js = 167 KB).

## Tests added or updated

- `tests/unit/settingsStore.test.ts` — 11 cases — `migrate()` behaviour for null / non-object / invalid logLevel / out-of-range temperature / garbage maxTokens / inferred firstRunComplete / explicit firstRunComplete override / unknown section-id rejection, plus `SettingsStore.load → migrate`, `SettingsStore.update` listener fan-out, and a save → reload round-trip with provider + ui fields. (NFR-USE-01, AC2, AC6)
- `tests/unit/wizardMachine.test.ts` — 18 cases — initial state, endpoint-edit + non-empty-required next, probing → models / models-empty / probe-failed branches, default-model inference, probe-failed back/retry, models guard on save, save → persisting → closed, persistError surfaces back to save, Back from save returns to picker, and a `cancel` truth-table closing the modal from every non-terminal state. (FR-UI-07, AC3, AC6)

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

None. Open-question defaults from `feature.md` were taken as proposed (single-modal wizard with numbered steps, dedicated `firstRunComplete` flag in `data.json`, per-user collapse-state persistence). The MCP-vs-`.leo/config.json` precedence question is intentionally untouched — it does not bite F03 because MCP UI is out of scope, and the `SettingsStore` already provides the single seam the future reconciler will need.

## Assumptions

- The provider model list shown in the live Provider section (`renderModelPicker`) is sourced from the most recent `Re-probe` click rather than running a probe on every settings open — keeps settings open instant, and the wizard already populated the stored ids on first run. Users who want a fresh list press `Re-probe`.
- Hotkey reachability (AC4) is delivered by `Plugin.addCommand` itself — Obsidian surfaces every registered command in its native Hotkeys UI as long as no default chord is shipped. Both new commands omit `hotkeys`/`hotkey` so users have full freedom; later features call `registerLeoCommand` through the same helper.
- The settings tab uses Obsidian's `Setting` builder + plain DOM for the seven sections; only the wizard step bodies use React (per ui.md component mapping). This keeps the steady-state settings surface free of React lifecycle concerns and concentrates React inside one short-lived modal.
- `SettingsTab.openWizard` is reused by both the welcome CTA and the `Leo: Configure LM Studio` palette command, so post-first-run reconfiguration uses exactly the same flow.
- The first-run flag flips only on a successful `persist`, matching the `saved → closed` transition in ui.md's state diagram; partial wizard cancellation persists endpoint edits but leaves `firstRunComplete=false` so the welcome panel returns next time.

## Open questions

- The wizard's model-list refresh is opportunistic (probe runs only inside the wizard or via Re-probe). If F30 or F38 want live status without user action, expose `SettingsTab.probeAndRender` through `SettingsTab` or move probe ownership into `ProviderManager` itself — flag for verifier.
- I have not added animated chevron rotation; ui.md only mentions reducing it under `prefers-reduced-motion: reduce`. The current implementation swaps the icon instantly via `setIcon`, which trivially satisfies the reduced-motion invariant without needing any media-query gating.
- No CSS file was added for `.leo-wizard-*` / `.leo-section-*` styles; visual polish lives in the next phase that owns Tailwind plumbing. The DOM is fully functional under Obsidian's default theme variables.
