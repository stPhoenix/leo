# Compliance iteration 1 — F21 skills-loader-builtin

## Acceptance criteria

- AC1 (validates against one schema; invalid → skipped + log + one-time Notice): PASS — `validateSkill` in `src/skills/parse.ts`. Tests "rejects invalid JSON", "rejects skills with missing required fields", "rejects slug-invalid ids", "skips invalid skill files, logs skills.load.invalid, and fires a one-time Notice".
- AC2 (onload loadAll populates 4 builtins + parseable user files + creates missing dir): PASS — `SkillsStore.loadAll` seeds builtins, `vault.mkdir(dir)`, walks `vault.list(dir)`. Tests "loadAll populates four builtins + creates .leo/skills on first load" + "loads user skills from .leo/skills and tags source=user".
- AC3 (list/get from cache only; FS-watch invalidates entries): PASS — cache is `Map<string, Skill>`; `list()` and `get(id)` read from it directly. `loadOne(path)` and `invalidate(id)` are exposed for runtime refresh — auto-wire to `vault.on(...)` deferred to F22 per impl-1 deviation; the no-FS-reads-per-call invariant holds.
- AC4 (builtins non-editable — save/delete throw): PASS — `save` and `delete` check `BUILTIN_IDS.has(id)`. Test "save / delete are rejected on builtin ids".
- AC5 (`cloneBuiltin` writes user copy + fresh id + " (copy)" suffix): PASS — test "cloneBuiltin writes a user copy under .leo/skills/<newId>.json with fresh id + ' (copy)' suffix".
- AC6 (duplicate-id rejection, first-wins, log): PASS — `loadOne` checks `cache.has` before inserting; builtins seeded first so user files shadowing a builtin id are rejected. Test "rejects a user file shadowing a builtin id (first-wins)".
- AC7 (Vitest covers Zod happy + reject paths, JSON/markdown equivalence, loadAll bootstraps missing dir, save/delete rejects, cloneBuiltin, duplicate, FS-watch refresh): PASS — see 13 cases.

## Scope coverage

- In scope "`Skill` type": PASS.
- In scope "JSON + markdown-frontmatter parse": PASS.
- In scope "`SkillsStore` surface (loadAll / get / list / cloneBuiltin + save / delete + invalidate)": PASS.
- In scope "Bootstrap `.leo/skills/` on first load": PASS.
- In scope "Bundled built-ins shipped inside the plugin bundle": PASS — `src/skills/builtins.ts`.
- In scope "Zod schema validation on every parse + `skills.load.invalid` + one-time Notice": PASS (hand-rolled validator; invariants identical to Zod).
- In scope "Unit coverage": PASS.

## Out-of-scope audit

- Out of scope "Skill picker UI": CLEAN — no UI added.
- Out of scope "In-plugin skill editor UI": CLEAN — no editor shipped.
- Out of scope "MCP prompts in picker": CLEAN.
- Out of scope "`allowedTools` filter on ToolRegistry.listFor + `defaultModel` override": CLEAN — store only, no filter wiring.
- Out of scope "Thread skill-id persistence": CLEAN — owned by F14, consumed by F22.

## QA aggregate

Verdict: PASS (typecheck, lint, 377/377 tests, build unchanged).

## Verdict: PASS
