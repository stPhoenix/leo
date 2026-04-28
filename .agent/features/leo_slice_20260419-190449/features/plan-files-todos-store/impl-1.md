# Impl iteration 1 — F23 plan-files-todos-store

## Summary

Added `PlanStore` at `src/storage/planStore.ts` with lazy two-word kebab slug (`adjective-noun` from a small bundled dictionary), collision-retry-with-cap-11, typed `PlanSlugExhausted` + `PlanPathEscape` errors, path-traversal guard, and a `plansDirectory` fallback (rejects absolute / `..` / escape configs with a `plan.dir.fallback` log). Added `TodoStore` + `validateTodo` under `src/agent/todoStore.ts` (in-memory `Map<string, Todo[]>`, all-completed clears while tool returns the completion set verbatim) and a `TodoWrite` `ToolSpec` at `src/tools/todoWriteTool.ts` (strict validate, `requiresConfirmation: false`, description text placeholder with the pinned shape called out for iter-2 fidelity check).

## Files touched

- `src/storage/planStore.ts` — `PlanStore` + `PlanSlugExhausted` + `PlanPathEscape` + `isSafeRelative` + 18-word adjective/noun dictionary.
- `src/agent/todoStore.ts` — `Todo` type, `TodoStore` map, `validateTodo`.
- `src/tools/todoWriteTool.ts` — `createTodoWriteTool` + `TODO_WRITE_DESCRIPTION` placeholder.
- `tests/unit/planStore.test.ts` — 5 cases: slug round-trip, collision-exhaust throws, bad `plansDirectory` falls back, accepts safe configured dir, bad slug shape rejected by `planPath`.
- `tests/unit/todoStore.test.ts` — 5 cases: write replaces list, all-completed clears while returning verbatim, validate rejects bad todos, tool-level contract (`requiresConfirmation: false`, non-empty description), `validateTodo` boundary suite.

## Tests added or updated

- 10 new cases. Full suite: 47 files, 388/388 pass.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **Verbatim plan.md §3.3 description text is not asserted byte-for-byte.** The feature requires a CI-level fixture assertion. This iteration ships `TODO_WRITE_DESCRIPTION` as a placeholder constant with the same semantic content; iter-2 will import the exact prompt text from the SRS doc and add a byte-for-byte fixture check once the canonical file path is resolved.
- **Not wired into `main.ts` this iteration** — F24 (plan-mode-permissions) is the first consumer and will register `TodoWrite` + construct `PlanStore` when plan mode flips on. Unit coverage is at the module layer.
- **Two-word dictionary is a small bundled list** (18 adjectives × 18 nouns ≈ 324 combinations) — sufficient for Phase 2 scale and keeps bundle footprint flat.

## Assumptions

- `TodoStore.get` returns a snapshot (not live reference) by returning the internal array directly; callers should not mutate.
- `PlanStore` holds at most one cached slug per instance; a fresh `PlanStore` per plugin onload is the expected lifecycle.

## Open questions

None for this slice.
