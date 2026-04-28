# F03 — Settings tab scaffold & first-run wizard

## Purpose

Deliver Leo's single source of user-facing configuration: an Obsidian `PluginSettingTab` with the collapsible section hierarchy Provider → Indexing → Skills → MCP Servers → Plan/Todos → Appearance → Advanced per [FR-UI-10](../../context.md#fr-ui-10), populated in Phase 1 with live Provider fields (endpoint URL, chat model, embedding model, temperature, max tokens) per [FR-PROV-09](../../context.md#fr-prov-09), a first-launch welcome empty state with a "Configure LM Studio" CTA that opens a step-by-step setup wizard per [FR-UI-07](../../context.md#fr-ui-07), a hotkey registry for every Leo command that is reachable from Obsidian's native hotkey UI per [NFR-USE-03](../../context.md#nfr-use-03), and all other configuration consolidated into this tab (no hidden config file UI for v1) per [NFR-USE-01](../../context.md#nfr-use-01) and [NFR-USE-02](../../context.md#nfr-use-02). It is the UI substrate every later settings-bearing feature mounts into.

## Scope

### In scope

- `SettingsTab` as an Obsidian `PluginSettingTab` rendering seven collapsible sections (Provider, Indexing, Skills, MCP Servers, Plan/Todos, Appearance, Advanced) in the exact order mandated by [FR-UI-10](../../context.md#fr-ui-10); later features fill their sections, this feature ships the empty scaffolds with headings and section-level placeholders.
- Provider section with live fields bound to plugin data: endpoint URL, chat model (picker sourced from the F02 `Provider.listModels()` call), embedding model (separate picker), temperature (0–2), max tokens (int). Model pickers degrade to a free-text input when the provider is unreachable.
- First-run detection (plugin data flag absent / empty) that renders an empty-state welcome panel inside the Provider section with a primary "Configure LM Studio" CTA opening the setup wizard.
- Setup wizard flow: (1) verify / edit endpoint URL, (2) probe `/v1/models` via F02, (3) pick chat + embedding model, (4) save + mark first-run complete. Cancellable at any step; persists partial progress.
- Hotkey registration for every Leo command surfaced so far (palette entries from later features register through the same shared helper) so users can rebind them via Obsidian's native Hotkeys UI.
- Read of `logLevel` already written by F01 so the Advanced section can flip it; writing back routes through Obsidian `saveData()`.
- Plugin data schema (versioned) and a thin settings store layer (`loadData` / `saveData`) so every later feature writes through one API.

### Out of scope

- No-index "Index vault" empty-state CTA and status-bar progress — ships with F30 `indexer-ui-controls` per [FR-UI-07](../../context.md#fr-ui-07).
- Empty-thread example prompts in the chat view — ships with F04 `chat-sidebar-view`.
- Cloud provider adapters, API-key fields, and `safeStorage` wiring — ship with F38 `cloud-providers-safestorage`.
- Tool-use and the `tools` OpenAI parameter — ship with F16 `tool-registry-builtin-read`.
- MCP server CRUD UI inside the MCP Servers section — ships with F55 `mcp-settings-ui`; Phase 1 leaves that section empty with a "configured in phase 6" placeholder.
- In-plugin skill editor UI inside the Skills section — ships with F39 `skill-editor-ui`; Phase 1 leaves that section empty with a pointer to `.leo/skills/`.
- Plan/Todos runtime — ships with F23–F26; Phase 1 leaves that section empty.
- Multi-thread CRUD settings — ship with F37 `multi-thread-management`.
- Cost-in-$ display — ships with F38 alongside cloud providers.

## Acceptance criteria

1. Opening Obsidian's Settings → Leo renders a single `PluginSettingTab` with exactly seven sections in the order Provider, Indexing, Skills, MCP Servers, Plan/Todos, Appearance, Advanced; each section header is collapsible (click to expand/collapse) and collapse state persists across re-opens of the Settings modal. (FR-UI-10)
2. The Provider section exposes editable fields for endpoint URL, chat model, embedding model, temperature, and max tokens; edits persist through Obsidian `saveData()` and are read back correctly after a plugin reload. (FR-PROV-09)
3. On a fresh install (no prior plugin data), opening the Settings tab renders a welcome empty state with a "Configure LM Studio" CTA; clicking the CTA opens a step-by-step setup wizard that probes the endpoint, lists models via F02, lets the user pick chat + embedding models, saves the result, and clears the first-run flag. (FR-UI-07, NFR-USE-02)
4. Every Leo command palette entry registered so far is also surfaced in Obsidian's native Hotkeys UI so users can bind or rebind any of them; no hardcoded key combinations block reassignment. (NFR-USE-03)
5. All user-configurable options that this feature owns (endpoint URL, models, temperature, max tokens, logLevel, first-run flag) are reachable from the Leo settings tab — no config-file-only knobs are introduced in Phase 1. (NFR-USE-01)
6. The welcome + wizard path is the only first-time setup the user must complete to reach a working LM Studio connection; subsequent launches skip the welcome panel and land directly on the populated Provider section. (NFR-USE-02, FR-UI-07)
7. The Skills, MCP Servers, and Plan/Todos sections render as empty collapsible scaffolds with a short pointer to their owning later features (F39 / F55 / F23–F26) so that later features can mount into the existing scaffold without restructuring. (FR-UI-10)

## Dependencies

- [F02 provider-lmstudio-core](../provider-lmstudio-core/feature.md) — the wizard's model-probe step calls `Provider.listModels()` and the Provider section's pickers consume it; endpoint/model/temperature/max-tokens fields persist the values F02 reads at runtime.
- Drives requirements [FR-PROV-09](../../context.md#fr-prov-09), [FR-UI-07](../../context.md#fr-ui-07), [FR-UI-10](../../context.md#fr-ui-10), [NFR-USE-01](../../context.md#nfr-use-01), [NFR-USE-02](../../context.md#nfr-use-02), [NFR-USE-03](../../context.md#nfr-use-03).
- Downstream consumers tracked in [features-index.md](../../features-index.md): F30 (no-index CTA mounts into Indexing section), F38 (cloud provider fields + API-key UI), F39 (skill editor mounts into Skills section), F55 (MCP server UI mounts into MCP Servers section), and F24/F25 (Plan/Todos section).

## Implementation notes

- [Architecture §3.1 UI Layer — SettingsTab](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) — names `SettingsTab` as a `PluginSettingTab` owning settings-form state; this feature implements that row.
- [Architecture §6 State Ownership — Plugin settings](../../../../architecture/architecture.md#6-state-ownership) — pins plugin settings to Obsidian `loadData()` / `data.json`; the settings store layer follows that row.
- [Architecture §5.1 Plugin Startup](../../../../architecture/architecture.md#51-plugin-startup) — shows `Settings` loaded before adapter init; wizard + first-run flag reads happen off that sequence.
- [Architecture §8 Extension Points](../../../../architecture/architecture.md#8-extension-points) — later UI features register into the existing section scaffold rather than restructuring it.
- [Tech stack — Platform APIs](../../../../standards/tech-stack.md#platform-apis) — names `PluginSettingTab`, `loadData` / `saveData` as the storage surface used here.
- [Tech stack — UI Layer](../../../../standards/tech-stack.md#ui-layer) — selects React + Tailwind + Obsidian CSS vars; the settings tab follows that stack.
- [Code style — Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) — requires `addCommand` for every palette entry and forbids direct `app.vault.adapter` access; the hotkey registry follows it.
- [Code style — React 18](../../../../standards/code-style.md#react-18) — governs the wizard's React component tree, hook ordering, and cleanup.
- [Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) — requires Obsidian CSS vars over hard-coded colors; applies to every section header and the welcome panel.
- [Code style — Error Handling](../../../../standards/code-style.md#error-handling) — governs wizard cancellation and endpoint-probe failure surfacing.
- [Best practices — Planning & Design](../../../../standards/best-practices.md#planning--design) — vertical-slice guidance justifies shipping the seven-section scaffold in Phase 1 so later features mount into a stable frame.

## Open questions

- Exact wizard copy and step layout (single modal vs stacked panels) is undefined by the SRS; defaulting to a single modal with numbered steps, pending ui-ux-engineer design pass.
- First-run flag storage: dedicated key in `data.json` vs inferred from "no endpoint set yet"; the former is more robust across partial edits and is the current lean.
- Section collapse state persistence scope: per-user (plugin data) vs per-session (in-memory) is unspecified; defaulting to per-user via `data.json` unless verification chooses otherwise.
- The SRS open question on `.leo/config.json` vs Obsidian settings-tab precedence (see context.md open questions) will bite MCP in F55; Phase 1 sidesteps it because MCP is out of scope here, but the settings store API should be shaped so the later reconciler has a single seam.
