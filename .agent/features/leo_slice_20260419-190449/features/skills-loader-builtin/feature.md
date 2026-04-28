# F21 — Skills loader + built-in skills

## Purpose

Deliver the Skills substrate every later thread-scoped prompt preset depends on: a typed `Skill` shape `{id, name, description, systemPrompt, allowedTools?, examples?, defaultModel?}` per [FR-SKILL-01](../../context.md#fr-skill-01), a `SkillsStore` that loads user-authored skill files from `<vault>/.leo/skills/` (one file per skill) and keeps them in an in-memory cache per [FR-SKILL-02](../../context.md#fr-skill-02), and a bundled set of four built-in skills — "General", "Write assistant", "Research", "Code helper" — marked non-editable but clonable per [FR-SKILL-03](../../context.md#fr-skill-03). Parse + validate via a single [Zod](../../../../standards/code-style.md#zod--tool-schemas) schema so downstream callers (F22 picker/active-skill, F27 indexer model reconcile, F39 editor, F54 MCP prompts) can read from one authoritative catalogue. This slice delivers the store only; UI selection, mid-thread switching, editor, and MCP prompt surfacing are explicitly later features.

## Scope

### In scope

- `Skill` type matching the [architecture §4](../../../../architecture/architecture.md#4-key-contracts) contract: `{id: string, name: string, description: string, systemPrompt: string, allowedTools?: string[], examples?: Array<{user,assistant}>, defaultModel?: string, source: "builtin" | "user"}` per [FR-SKILL-01](../../context.md#fr-skill-01).
- Single canonical file format: JSON files `.leo/skills/<id>.json` parsed into `Skill`; a sibling markdown form `.leo/skills/<id>.md` with YAML frontmatter (`id`, `name`, `description`, `allowedTools?`, `examples?`, `defaultModel?`) + markdown body as `systemPrompt`. Both route through one Zod schema per [FR-SKILL-01](../../context.md#fr-skill-01), [FR-SKILL-02](../../context.md#fr-skill-02); ambiguity called out in Open questions.
- `SkillsStore` module with `loadAll() / get(id) / list() / cloneBuiltin(id, newId)` surface, backed by an in-memory `Map<string, Skill>` cache populated on `Plugin.onload` and on directory change (`vault.on('create'|'modify'|'delete'|'rename')` scoped to `.leo/skills/`) per [architecture §8](../../../../architecture/architecture.md#8-extension-points).
- `.leo/skills/` directory bootstrap: create it on first load if missing; skills with `source: "user"` are writable, `source: "builtin"` are read-only (store rejects `save`/`delete` for builtin ids).
- Bundled built-in skills shipped inside the plugin bundle: `general` (default, no `allowedTools`), `write-assistant`, `research`, `code-helper`; each exposes a `cloneBuiltin(id, newId)` path that writes a new user copy under `.leo/skills/<newId>.json` with `source: "user"` per [FR-SKILL-03](../../context.md#fr-skill-03).
- Zod schema validation on every parse; invalid files are skipped with a structured `skills.load.invalid` log event (F01 `Logger`) carrying `{path, issue}` and a user-facing `Notice` on first offender per load; a second identical failure is logged-only.
- Unit coverage for: Zod schema happy / reject paths, JSON + markdown-frontmatter parse equivalence, duplicate-id rejection (user file shadowing a builtin id → rejected), `cloneBuiltin` writes a user copy and stamps a fresh `id`, FS-watch invalidation refreshes the cache.

### Out of scope

- Skill picker UI in the thread header + mid-thread switch (`FR-CHAT-12`, `FR-SKILL-05`, `FR-SKILL-06`) → ships with [F22 skills-picker-active-skill](../../features-index.md).
- In-plugin skill editor UI (create / edit / delete / duplicate via settings or dedicated view, `FR-SKILL-04`) → ships with [F39 skill-editor-ui](../../features-index.md).
- MCP prompts surfaced in the skill picker as "From MCP" (`FR-MCP-09`) → ships with [F54 mcp-prompts-in-skills](../../features-index.md).
- `allowedTools` filter on `ToolRegistry.listFor(thread)` and `defaultModel` override wiring (`FR-SKILL-07`, `FR-SKILL-08`, `FR-AGENT-12`) → ship with [F22](../../features-index.md); this feature only stores the fields.
- Persistence of the thread's selected skill id → lives in thread metadata (owned by [F14 conversation-persistence-v1](../conversation-persistence-v1/feature.md)) and consumed by F22.

## Acceptance criteria

1. A `Skill` parsed from either `.leo/skills/<id>.json` or `.leo/skills/<id>.md` (YAML frontmatter + markdown body) validates against one Zod schema exposing `{id, name, description, systemPrompt, allowedTools?, examples?, defaultModel?}`; invalid files are skipped and emit `skills.load.invalid` via F01 `Logger` with a one-time `Notice`. ([FR-SKILL-01](../../context.md#fr-skill-01), [FR-SKILL-02](../../context.md#fr-skill-02))
2. On `Plugin.onload`, `SkillsStore.loadAll()` populates an in-memory cache with the four bundled built-in skills (`general`, `write-assistant`, `research`, `code-helper`, each `source: "builtin"`) plus every parseable file under `<vault>/.leo/skills/` tagged `source: "user"`; missing directory is created. ([FR-SKILL-02](../../context.md#fr-skill-02), [FR-SKILL-03](../../context.md#fr-skill-03))
3. `SkillsStore.list()` and `SkillsStore.get(id)` serve exclusively from the in-memory cache (no FS reads per call); `vault.on('create'|'modify'|'delete'|'rename')` events scoped to `.leo/skills/` invalidate and refresh the affected entry only. ([FR-SKILL-02](../../context.md#fr-skill-02))
4. Built-in skills are non-editable: `SkillsStore.save(skill)` or `delete(id)` called against a `source: "builtin"` id throws a typed error and writes nothing to disk. ([FR-SKILL-03](../../context.md#fr-skill-03))
5. `SkillsStore.cloneBuiltin(sourceId, newId)` writes a `.leo/skills/<newId>.json` copy of the built-in with `source: "user"`, `id: newId`, identical `name` (suffix `" (copy)"`) / `description` / `systemPrompt` / `allowedTools` / `examples` / `defaultModel`; the new skill appears in `list()` on next tick. ([FR-SKILL-03](../../context.md#fr-skill-03))
6. Duplicate-id rejection: if a user file declares an `id` matching any `source: "builtin"` id (or a previously loaded user id), the later file is rejected with a `skills.load.duplicate` log event; the first-loaded entry wins. ([FR-SKILL-01](../../context.md#fr-skill-01), [FR-SKILL-02](../../context.md#fr-skill-02))
7. Vitest suite covers: Zod happy + reject paths; JSON vs markdown-frontmatter parse equivalence on a round-trip fixture; `loadAll` bootstraps missing `.leo/skills/`; `save` / `delete` rejected on builtin ids; `cloneBuiltin` writes a valid user file with a fresh id; duplicate-id rejection; FS-watch refresh replaces only the changed entry. ([FR-SKILL-01](../../context.md#fr-skill-01), [FR-SKILL-02](../../context.md#fr-skill-02), [FR-SKILL-03](../../context.md#fr-skill-03))

## Dependencies

- [F01 plugin-bootstrap-logging](../plugin-bootstrap-logging/feature.md) — supplies the `Plugin.onload` lifecycle where `SkillsStore.loadAll()` runs, the structured `Logger` used for `skills.load.*` events per [NFR-LOG-04](../../context.md#nfr-log-04), and the `Notice` channel for the one-time invalid-file user surface per [NFR-LOG-03](../../context.md#nfr-log-03).
- Drives requirements [FR-SKILL-01](../../context.md#fr-skill-01), [FR-SKILL-02](../../context.md#fr-skill-02), [FR-SKILL-03](../../context.md#fr-skill-03); related glossary entry in [context.md Glossary — Skill](../../context.md#glossary).
- Downstream consumers tracked in [features-index.md](../../features-index.md): F22 (active-skill application + `allowedTools`/`defaultModel`), F23 (plan files leverage skill prompts), F27 (indexer reindex-on-model-switch interplay with `defaultModel`), F39 (editor UI), F54 (MCP prompts merged into picker).

## Implementation notes

- [Architecture §3.2 Agent Layer — SkillsStore](../../../../architecture/architecture.md#32-agent-layer) — places `SkillsStore` in the agent layer alongside `ToolRegistry`; this feature delivers that row.
- [Architecture §3.4 Adapters — VaultAdapter](../../../../architecture/architecture.md#34-adapters) — skill file IO routes through `VaultAdapter`, never `app.vault.adapter` directly.
- [Architecture §4 Key Contracts — Skill](../../../../architecture/architecture.md#4-key-contracts) — pins the exact `Skill` interface this store parses and emits.
- [Architecture §5.1 Plugin Startup](../../../../architecture/architecture.md#51-plugin-startup) — shows `SkillsStore` loaded in parallel with settings / conversations at `Plugin.onload`.
- [Architecture §6 State Ownership — Skills](../../../../architecture/architecture.md#6-state-ownership) — declares `.leo/skills/*.md or *.json` as the on-disk source of truth; this feature realises it.
- [Architecture §8 Extension Points — New skill](../../../../architecture/architecture.md#8-extension-points) — "Drop file in `.leo/skills/`. Hot-reloaded by `SkillsStore`" is the pattern implemented here.
- [Architecture §11 Mapping SRS FR → Modules](../../../../architecture/architecture.md#11-mapping-srs-fr--modules) — `FR-SKILL-*` routes to `SkillsStore` / `SkillPicker` / `SkillEditor`; this slice delivers the store tier.
- [Tech stack — Agent / Tool / Skill / MCP Wiring](../../../../standards/tech-stack.md#agent--tool--skill--mcp-wiring) — pins "Markdown/JSON files in `.leo/skills/`. Parsed into `Skill` objects." as the canonical shape.
- [Tech stack — Storage Layout](../../../../standards/tech-stack.md#storage-layout) — fixes the `<vault>/.leo/` tree this loader writes into and bootstraps.
- [Tech stack — Dependencies — Production](../../../../standards/tech-stack.md#dependencies--production) — names `zod` as the validation dependency used by the schema.
- [Code style — Zod & Tool Schemas](../../../../standards/code-style.md#zod--tool-schemas) — one Zod schema per external shape, `z.infer` for TS, no dual declaration; applies to the `Skill` schema here.
- [Code style — Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) — never touch `app.vault.adapter` directly; route through `VaultAdapter` and register watchers for auto-cleanup.
- [Code style — Error Handling](../../../../standards/code-style.md#error-handling) — parsers surface typed `Result`; resources (file handles) released in `finally`.
- [Code style — Logging](../../../../standards/code-style.md#logging) — fixes the `event: "skills.*"` structured field shape used by the three log events.
- [Code style — Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw) — selects the harness; `VaultAdapter` faked in-memory for every test in AC7.
- [Best practices — Core Principles](../../../../standards/best-practices.md#core-principles) — Single Responsibility + Fail Fast: store is pure lookup + parse; invalid files fail fast at load, never at use.

## Open questions

- **Skill field naming conflict (global [open questions](../../context.md#open-questions))**: SRS §1.3 Glossary uses `defaultTools`, FR-SKILL-01 uses `allowedTools`. This feature picks `allowedTools` (authoritative per FR-SKILL-01 and [architecture §4](../../../../architecture/architecture.md#4-key-contracts)); the verifier should confirm and propose an SRS erratum closing the glossary row.
- **Skill file format ambiguity (global [open questions](../../context.md#open-questions))**: "JSON/markdown" is underspecified. This feature accepts both `.json` and `.md` (YAML frontmatter + body = `systemPrompt`) since both are idiomatic in Obsidian vaults; if the project prefers a single format, collapse to one here and surface the decision to F39.
- **Mid-thread skill change vs autocompact summary recall (global [open questions](../../context.md#open-questions))** — orthogonal to this slice (store-only); flagged for F22 / F43 to resolve when they wire `systemPrompt` into the compaction prompt.
- **`defaultModel` + MCP prompt collision (global [open questions](../../context.md#open-questions))** — not triggered here (MCP prompts enter the catalogue via F54); resolved at picker-level in F22 / F54.
