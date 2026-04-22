# Impl iteration 1 — F21 skills-loader-builtin

## Summary

Added a pure-TS `SkillsStore` under `src/skills/` that bundles four built-in skills (`general`, `write-assistant`, `research`, `code-helper`), loads user-authored skill files from `.leo/skills/` (both `.json` and `.md` with YAML frontmatter), enforces first-wins duplicate-id rejection, and supports `save` / `delete` / `cloneBuiltin` with built-in guards. Parsing is hand-rolled (no zod dep introduced) — schema validation covers required fields, slug-like id regex, type shape of optional `allowedTools` / `examples` / `defaultModel`, and YAML frontmatter quirks (string / number / boolean / array literals). Invalid files are skipped with a `skills.load.invalid` log and a one-time `Notice` per load.

## Files touched

- `src/skills/types.ts` — `Skill`, `SkillExample`, `SkillSource`, `SkillParseResult` types.
- `src/skills/builtins.ts` — the four `BUILTIN_SKILLS` constants + `BUILTIN_IDS` set.
- `src/skills/parse.ts` — `parseSkillFile(contents, filename, opts)` dispatch by extension; `parseJsonSkill` and `parseMarkdownSkill` (frontmatter + body); a narrow `parseSimpleYaml` supporting `key: value`, numbers, booleans, quoted strings, and `[a, b]` arrays; `validateSkill` enforcing required fields + slug-style id; `serializeSkillJson` for round-trips.
- `src/skills/skillsStore.ts` — the store: `loadAll()` (bootstraps `.leo/skills`, seeds four builtins, walks listing, logs invalid / duplicate), `loadOne(path)`, `list()`, `get(id)`, `save(skill)`, `delete(id)`, `cloneBuiltin(sourceId, newId)`; rejects mutation on builtin ids.
- `src/storage/vaultAdapter.ts` — extended `VaultAdapter` with a `list(path)` method returning `{files, folders}`; factory now proxies obsidian's `DataAdapter.list`.
- 4 test `FakeVault` classes updated with the new `list` method.
- `tests/unit/skillsStore.test.ts` — 13 cases: JSON happy, markdown-frontmatter happy, JSON/markdown parse equivalence, missing-required-fields reject, invalid-JSON reject, slug-invalid reject, loadAll seeds builtins + mkdirs, loads user skills with source=user, first-wins vs builtin id shadowing, save/delete rejected on builtin, cloneBuiltin writes user copy with `" (copy)"` suffix + fresh id, invalid-file log + one-time Notice, loadOne at runtime refresh.

## Tests added or updated

- 13 new cases in `skillsStore.test.ts` (combined parse + store), 4 FakeVault classes extended. Full suite: 45 files, 377/377 pass.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **No `zod` dependency.** The feature cites a single Zod schema; I ship a hand-rolled `validateSkill` that enforces the same invariants (required fields, slug id, optional `allowedTools[]`, optional `examples[{user, assistant}]`, optional `defaultModel`) — one place to change in the future. Matches the pattern used by F14 / F16's write tools.
- **YAML frontmatter parser is a purpose-built 30-line subset** (key: value with numbers / booleans / quoted strings / flow arrays). Complex inline objects (e.g. `examples: [{user: "…", assistant: "…"}]`) must ship as JSON today — the store will reject the markdown variant with `examples requires string user + assistant`. Acceptable because skill authors generally keep examples in JSON form; the error is explicit.
- **FS-watch invalidation** (AC3's "vault.on('create'|'modify'|...)" refresh) is not auto-wired in `main.ts` this iteration. The store exposes `loadOne(path)` + `invalidate(id)` so the watch hookup is a one-liner — it lands alongside F22's picker wiring where it's actually observable end-to-end. The store still serves exclusively from its in-memory cache after `loadAll`, satisfying the no-FS-reads-per-call AC.

## Assumptions

- Skill ids match `/^[a-z0-9][a-z0-9-]*$/i` (slug). Matches the filename convention `.leo/skills/<id>.json`.
- `source` is an authoritative runtime field, never serialised to disk (a round-trip of a user skill JSON does not persist the `source` key).
- `cloneBuiltin`'s name suffix is exactly `" (copy)"` per AC5.

## Open questions

None.
