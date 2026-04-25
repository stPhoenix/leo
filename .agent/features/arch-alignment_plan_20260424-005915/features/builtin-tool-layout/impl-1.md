# Impl iteration 1 — F03 builtin-tool-layout

## Summary

Relocated the five vault/editor built-in tools into `src/tools/builtin/` with arch-spec filenames. Moves preserved git history via `git mv`; `writeTools.ts` was split by concern into `builtin/createNote.ts` + `builtin/appendToNote.ts`. All import sites (production + tests) updated; no public tool IDs changed.

## Files touched

**Moves (git mv, history preserved):**
- `src/tools/readNoteTool.ts` → `src/tools/builtin/readNote.ts`
- `src/tools/editNoteTool.ts` → `src/tools/builtin/editNote.ts`
- `src/tools/createFolderTool.ts` → `src/tools/builtin/createFolder.ts`

**Split (writeTools.ts deleted, replaced by two new files):**
- NEW `src/tools/builtin/createNote.ts` — `createCreateNoteTool()` + `CreateNoteArgs` / `CreateNoteResult`.
- NEW `src/tools/builtin/appendToNote.ts` — `createAppendToNoteTool()` + `AppendToNoteArgs` / `AppendToNoteResult`.
- DELETED `src/tools/writeTools.ts`.

**Import fixes inside moved files:**
- `src/tools/builtin/readNote.ts` — `./types` → `../types`, `./zodAdapter` → `../zodAdapter`.
- `src/tools/builtin/editNote.ts` — same plus `./readNoteTool` → `./readNote`.
- `src/tools/builtin/createFolder.ts` — same plus `./readNoteTool` → `./readNote`.

**External consumer updates:**
- `src/main.ts` — 5 imports swapped to `@/tools/builtin/{readNote,createNote,appendToNote,createFolder,editNote}`.
- `src/tools/user/userToolsLoader.ts` — `isSafeVaultPath` import relocated to `../builtin/readNote`.
- `src/editor/activeNoteEditBridge.ts` — `EditNoteBridge` type import moved to `@/tools/types` (where F02 placed it; no longer re-imports via editNoteTool).
- `tests/llm/_fakes.ts` — same `EditNoteBridge` relocation.
- `tests/llm/agent.live.test.ts` — factory imports updated.
- `tests/unit/readNoteTool.test.ts`, `tests/unit/writeTools.test.ts`, `tests/unit/editNoteTool.test.ts`, `tests/unit/createFolderTool.test.ts`, `tests/unit/toolRegistrySnapshot.test.ts` — imports updated.
- `tests/unit/toolCtxGuard.test.ts` — `BUILTIN_TOOL_FILES` list updated to point at new paths (`src/tools/builtin/*`); per-file assertions updated.

## Tests added or updated

- No new test files this iteration.
- 6 test files updated to point at new import paths (fixture-only diff).
- `toolCtxGuard.test.ts` rescoped to the new paths — the regex guard continues to enforce F02's invariant at the new locations.
- Full test run: 118 files, 1095 tests passing.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

1. **`createFolderTool` relocated to `src/tools/builtin/createFolder.ts` even though architecture.md §9 does not list it under `builtin/`.** Feature.md scope mentions `createFolderTool.ts` in an ambiguous sentence alongside `writeTools.ts`. The only consistent read is that every vault-mutating built-in tool lives under `builtin/`; leaving `createFolder` at `src/tools/` would create an inexplicable split. Shipped: `src/tools/builtin/createFolder.ts`. If arch intent was to leave it at `src/tools/createFolder.ts`, trivial to revert.
2. **Test file names unchanged.** `tests/unit/readNoteTool.test.ts` etc. still carry the old basenames. Architecture §9 does not dictate test file names; renaming would expand the diff with no functional benefit. Revisit in a later cosmetic pass if desired.
3. **`writeTools.ts` split produces separate `CreateNoteArgs` / `AppendToNoteArgs` types (previously both used the shared `WriteArgs`).** They have identical shape today; splitting the types follows the "split by concern" mandate in feature.md and lets each schema describe its own `path` / `content` field more precisely for future divergence. Zero wire impact — each tool still emits the same `parameters` JSON via `jsonSchemaFromZod`.
4. **`planModeTools.ts` and `todoWriteTool.ts` remain at `src/tools/`.** Not in arch §9 `builtin/` list; feature.md explicitly excluded them. No change.

## Assumptions

1. **`git mv` preserves history.** Verified via `git status -s` output showing `RM` rename entries for readNote/editNote/createFolder; writeTools was split into two new files so it shows `D` + two `??` — expected for a split.
2. **Test file naming is not load-bearing.** No CI job filters by exact test file names.

## Open questions

1. **Test file renames.** Worth shipping `readNoteTool.test.ts` → `readNote.test.ts` etc. in a follow-up? Low value, low cost.
2. **`createFolder` location.** Confirm with user if arch intent was to keep it at `src/tools/createFolder.ts`. Default: ship in `builtin/` as done.
