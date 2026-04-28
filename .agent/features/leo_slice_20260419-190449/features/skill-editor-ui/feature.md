# F39 — In-plugin skill editor UI

## Purpose

Deliver the GUI that lets a user create, edit, delete, and duplicate Skills from inside Obsidian — no more hand-editing `.leo/skills/*.json` / `.md` files to manage prompt presets — satisfying [FR-SKILL-04](../../context.md#fr-skill-04). The editor mounts into the previously-reserved Skills section of the settings tab (scaffolded by [F03](../settings-tab-scaffold/feature.md)) and writes exclusively through [F21](../skills-loader-builtin/feature.md)'s `SkillsStore`, so the on-disk source of truth, Zod schema validation, built-in vs user `source` enforcement, and cache-refresh semantics all remain centralised in a single authoritative catalogue. This slice delivers CRUD UI only; skill activation, mid-thread switching, `allowedTools` / `defaultModel` runtime wiring, and MCP-prompt surfacing remain owned by their upstream features.

## Scope

### In scope

- A `SkillEditor` React surface mounted in the Skills section of the settings tab, listing every Skill returned by `SkillsStore.list()` with `source` ("builtin" / "user") distinctly labelled per [FR-SKILL-04](../../context.md#fr-skill-04) and the authoritative field list from [FR-SKILL-01](../../context.md#fr-skill-01).
- A form that edits every Skill field the Zod schema exposes — `id`, `name`, `description`, `systemPrompt` (multi-line), `allowedTools?` (tool-id multiselect sourced from `ToolRegistry`), `examples?` (array of `{user, assistant}` pairs), `defaultModel?` (free-text with datalist suggestions from the provider) — with per-field inline validation mirroring the shared Zod schema defined by [F21](../skills-loader-builtin/feature.md).
- Create: "New skill" action produces a blank draft with an auto-generated kebab `id`, unique-id check against `SkillsStore.list()`, and persists via `SkillsStore.save()` on Save with a success `Notice` per [FR-SKILL-04](../../context.md#fr-skill-04).
- Edit: only user skills (`source: "user"`) expose the form in editable state; fields persist through `SkillsStore.save()`; the cache-refresh event from [F21](../skills-loader-builtin/feature.md) re-renders the list without reload.
- Delete: user skills only; confirmation prompt ("Delete skill <name>?"); routes through `SkillsStore.delete(id)`; threads currently bound to the deleted skill fall back to "General" on next turn (handled by [F22](../skills-picker-active-skill/feature.md)'s missing-id fallback — this feature surfaces a warning in the confirmation body when the count of affected threads > 0).
- Duplicate: any skill, built-in or user, can be duplicated via a "Duplicate" action that routes through `SkillsStore.cloneBuiltin(id, newId)` (or an equivalent `clone(id, newId)` path for user→user) producing a new user file with a fresh id and `" (copy)"` name suffix per [FR-SKILL-03](../../context.md#fr-skill-03); built-in originals remain untouched.
- Built-in skills are read-only in the form (fields disabled, no Save / Delete buttons, only "Duplicate" exposed) — the UI enforces the same invariant the store enforces.
- Unsaved-changes guard: closing the settings modal or switching between skills with a dirty form prompts the user to save or discard; cancellable Esc behaviour matches [FR-UI-08](../../context.md#fr-ui-08) inline-dialog policy.
- Structured log events `skills.editor.save`, `skills.editor.delete`, `skills.editor.duplicate` on every mutation; error paths surface a user `Notice` and leave the store untouched.
- Vitest coverage for: form-level Zod validation parity with the F21 schema, built-in read-only enforcement, duplicate-id guard on Create, Delete-with-bound-threads warning copy, unsaved-changes guard, `cloneBuiltin` round-trip.

### Out of scope

- Skill selection per thread, HeaderBar badge, and mid-thread switch — owned by [F22 skills-picker-active-skill](../skills-picker-active-skill/feature.md) per [FR-CHAT-12](../../context.md#fr-chat-12), [FR-SKILL-05](../../context.md#fr-skill-05), [FR-SKILL-06](../../context.md#fr-skill-06).
- `allowedTools` filtering of `ToolRegistry.listFor(thread)` and `defaultModel` override at provider dispatch — owned by [F22](../skills-picker-active-skill/feature.md) per [FR-SKILL-07](../../context.md#fr-skill-07), [FR-SKILL-08](../../context.md#fr-skill-08), [FR-AGENT-12](../../context.md#fr-agent-12).
- Loader / parser / Zod schema / `source` tagging / FS-watch invalidation / `cloneBuiltin` on-disk write — owned by [F21 skills-loader-builtin](../skills-loader-builtin/feature.md) per [FR-SKILL-01](../../context.md#fr-skill-01), [FR-SKILL-02](../../context.md#fr-skill-02), [FR-SKILL-03](../../context.md#fr-skill-03).
- MCP-prompt "From MCP" section of the skill picker — owned by F54 (not yet detailed).
- A dedicated full-pane `ItemView` editor (the architecture mentions a phase-5 `SkillEditor` `ItemView`); this slice mounts inside the settings tab only, leaving a separate dedicated view as a follow-up if usage demands it.
- Settings-tab section scaffold (headings, collapse state, hotkeys, plugin data store) — owned by [F03 settings-tab-scaffold](../settings-tab-scaffold/feature.md).

## Acceptance criteria

1. Opening Obsidian Settings → Leo → Skills renders the list of every Skill returned by `SkillsStore.list()` with "Built-in" or "User" badges distinguishing `source`; list updates live when the `SkillsStore` cache refreshes from F21's FS-watch. ([FR-SKILL-04](../../context.md#fr-skill-04), [FR-SKILL-02](../../context.md#fr-skill-02))
2. Selecting a user skill opens an editable form with inputs bound to `id` (read-only after create), `name`, `description`, `systemPrompt`, `allowedTools?`, `examples?`, `defaultModel?`; Save routes through `SkillsStore.save(skill)` and a success `Notice` is shown; invalid values are blocked by inline Zod validation mirroring [F21](../skills-loader-builtin/feature.md)'s schema. ([FR-SKILL-04](../../context.md#fr-skill-04), [FR-SKILL-01](../../context.md#fr-skill-01))
3. Selecting a built-in skill opens the same form in read-only state (inputs disabled); Save and Delete are absent; Duplicate is the only available action, consistent with F21's rejection of `save`/`delete` on `source: "builtin"` ids. ([FR-SKILL-04](../../context.md#fr-skill-04), [FR-SKILL-03](../../context.md#fr-skill-03))
4. "New skill" produces a blank draft with an auto-generated kebab `id`; attempting to save with an `id` that collides with any existing `SkillsStore.list()` entry is blocked with an inline error and the store is never called. ([FR-SKILL-04](../../context.md#fr-skill-04), [FR-SKILL-01](../../context.md#fr-skill-01))
5. Delete on a user skill opens a confirmation prompt ("Delete skill <name>?"); on confirm, `SkillsStore.delete(id)` removes the file and the list entry disappears on the next `SkillsStore.list()` tick; when the to-be-deleted `id` is bound to one or more threads (queried via [F14](../conversation-persistence-v1/feature.md) metadata), the confirmation body shows an "N thread(s) will fall back to General" warning. ([FR-SKILL-04](../../context.md#fr-skill-04))
6. Duplicate on any Skill produces a user copy with fresh `id` (collision-retried) and `" (copy)"` suffixed name via `SkillsStore.cloneBuiltin(id, newId)` (or the equivalent user-clone path); the new skill appears in the list and opens as a user-editable draft. ([FR-SKILL-04](../../context.md#fr-skill-04), [FR-SKILL-03](../../context.md#fr-skill-03))
7. Closing the settings modal or switching between skills with unsaved edits prompts "Save changes? [Save] [Discard] [Cancel]"; Esc cancels consistently with [FR-UI-08](../../context.md#fr-ui-08) inline-dialog conventions; no mutation reaches `SkillsStore` until Save is confirmed. ([FR-SKILL-04](../../context.md#fr-skill-04), [FR-UI-08](../../context.md#fr-ui-08))
8. Every mutation emits a structured log event (`skills.editor.save`, `skills.editor.delete`, `skills.editor.duplicate`) via F01 `Logger` carrying `{id, source}`; failures surface as a user `Notice` with the store left untouched. ([NFR-LOG-04](../../context.md#nfr-log-04), [NFR-LOG-03](../../context.md#nfr-log-03))
9. Vitest suite covers: form-level Zod validation matching the F21 schema; built-in read-only enforcement (no Save / Delete rendered); duplicate-id guard on Create; Delete-with-bound-threads warning copy; unsaved-changes guard; `cloneBuiltin` round-trip producing a valid user file. ([FR-SKILL-04](../../context.md#fr-skill-04), [FR-SKILL-03](../../context.md#fr-skill-03))

## Dependencies

- [F21 skills-loader-builtin](../skills-loader-builtin/feature.md) — the only path this feature uses to read / write / clone / delete skills; provides the authoritative Zod schema the form mirrors, the `source` tagging that gates read-only UI, and the FS-watch-driven cache refresh that keeps the list live per [FR-SKILL-01](../../context.md#fr-skill-01), [FR-SKILL-02](../../context.md#fr-skill-02), [FR-SKILL-03](../../context.md#fr-skill-03).
- [F03 settings-tab-scaffold](../settings-tab-scaffold/feature.md) — supplies the Skills section placeholder this editor mounts into, the collapsible section hierarchy per [FR-UI-10](../../context.md#fr-ui-10), and the plugin data / settings-modal lifecycle the unsaved-changes guard hooks into.
- Drives requirement [FR-SKILL-04](../../context.md#fr-skill-04); interacts with [FR-UI-08](../../context.md#fr-ui-08) inline-dialog policy for the unsaved-changes and delete confirmation prompts, and with [FR-UI-10](../../context.md#fr-ui-10) for section placement.
- Downstream consumers tracked in [features-index.md](../../features-index.md): [F22 skills-picker-active-skill](../skills-picker-active-skill/feature.md) (missing-id fallback when a bound skill is deleted), [F14 conversation-persistence-v1](../conversation-persistence-v1/feature.md) (thread metadata queried for the Delete warning), and F54 MCP prompts (read-only parity expected when MCP skills appear).

## Implementation notes

- [Architecture §3.1 UI Layer — SkillEditor](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) — names `SkillEditor` as the GUI for creating/editing skills; this slice delivers the settings-tab variant.
- [Architecture §3.2 Agent Layer — SkillsStore](../../../../architecture/architecture.md#32-agent-layer) — fixes `SkillsStore` as the only seam for skill CRUD; the editor never touches the FS directly.
- [Architecture §4 Key Contracts — Skill](../../../../architecture/architecture.md#4-key-contracts) — pins the exact `Skill` interface the form binds to.
- [Architecture §6 State Ownership — Skills](../../../../architecture/architecture.md#6-state-ownership) — confirms `.leo/skills/*.md or *.json` as the on-disk source of truth this editor mutates through `SkillsStore`.
- [Architecture §7 Error Handling Strategy](../../../../architecture/architecture.md#7-error-handling-strategy) — governs Save / Delete failure surfacing and ensures the store stays clean on UI errors.
- [Architecture §8 Extension Points — New skill](../../../../architecture/architecture.md#8-extension-points) — the "drop file, hot-reload" pattern this UI writes into.
- [Architecture §11 Mapping SRS FR → Modules](../../../../architecture/architecture.md#11-mapping-srs-fr--modules) — `FR-SKILL-*` routes to `SkillsStore` / `SkillPicker` / `SkillEditor`; this slice delivers the editor row.
- [Tech stack — UI Layer](../../../../standards/tech-stack.md#ui-layer) — selects React + Tailwind + Obsidian CSS vars; the editor follows that stack.
- [Tech stack — Platform APIs](../../../../standards/tech-stack.md#platform-apis) — names `PluginSettingTab`, `Notice`, `setIcon` as the Obsidian surfaces used here.
- [Tech stack — Agent / Tool / Skill / MCP Wiring](../../../../standards/tech-stack.md#agent--tool--skill--mcp-wiring) — pins skills as files in `.leo/skills/`, keeping the editor's write path congruent with F21's loader.
- [Tech stack — Dependencies — Production](../../../../standards/tech-stack.md#dependencies--production) — names `zod` as the validation dependency the form shares with F21's schema.
- [Code style — Zod & Tool Schemas](../../../../standards/code-style.md#zod--tool-schemas) — one Zod schema per external shape; the form reuses F21's schema rather than redeclaring.
- [Code style — React 18](../../../../standards/code-style.md#react-18) — governs the editor's component tree, hook ordering, and unsaved-changes cleanup.
- [Code style — Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) — forbids direct `app.vault.adapter` access; all IO goes through `SkillsStore` / `VaultAdapter`.
- [Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) — requires Obsidian CSS vars; applies to the list, form, and confirmation prompts.
- [Code style — Error Handling](../../../../standards/code-style.md#error-handling) — governs typed `Result` surfacing on Save / Delete failure paths.
- [Code style — Logging](../../../../standards/code-style.md#logging) — fixes the `event: "skills.editor.*"` structured field shape used by AC8.
- [Code style — Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw) — selects the harness; the store is faked in-memory per test case.
- [Best practices — Core Principles](../../../../standards/best-practices.md#core-principles) — Single Responsibility: editor is pure form + store dispatch; no FS / cache logic leaks from F21.

## Open questions

- **Editor host: settings-tab vs dedicated `ItemView`** — [architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) references a phase-5 `SkillEditor` `ItemView`, but FR-SKILL-04 also permits a settings page. This slice commits to the settings-tab variant to reuse [F03](../settings-tab-scaffold/feature.md)'s Skills section and reduce surface area; if usage demands a full-pane editor later, it can be added as a follow-up without breaking this UI.
- **Skill field naming / file format** — inherited from the global [open questions](../../context.md#open-questions) (see F21's open questions); the form binds to whatever authoritative schema F21 lands on and surfaces both JSON and markdown-frontmatter entries identically.
- **Delete-with-bound-threads handling** — this slice shows a warning count in the confirmation prompt and relies on F22's missing-id fallback to "General"; an alternative (block delete until threads are reassigned) is not specified by FR-SKILL-04 and is left for verification.
- **Built-in duplicate name collision** — duplicating "General" twice in a row yields "General (copy)" and "General (copy) (copy)"; whether to auto-append numeric suffixes on repeat duplicates is unspecified.
- **`defaultModel` autocomplete source** — the field is free-text with datalist suggestions pulled from the provider's `/v1/models` probe; if the provider is unreachable the datalist collapses to empty, which is acceptable but not explicitly covered by FR-SKILL-04.
- **Examples editor UX** — `examples?` is a list of `{user, assistant}` pairs; the SRS does not fix a UI (inline editable rows vs modal-per-example). This slice defaults to inline rows with add/remove buttons, pending UI-design verification.
