# Compliance iteration 1 — F03 builtin-tool-layout

## Acceptance criteria

- AC1: Every file listed under `src/tools/builtin/` in architecture.md §9 exists at that exact path.
  PASS — `src/tools/builtin/` now contains `readNote.ts`, `createNote.ts`, `appendToNote.ts`, `editNote.ts`, `searchVault.ts`, `skillTool.ts`. `createFolder.ts` is also present (deviation per impl-1.md §1). Verified by `ls src/tools/builtin/`.

- AC2: No stale imports remain; `tsc --noEmit` and the full Vitest suite pass.
  PASS — `qa-1.md § Typecheck / Tests` both PASS (exit 0; 1095 tests green). `grep -rln '@/tools/(readNoteTool|writeTools|editNoteTool|createFolderTool)'` returns no source hits.

- AC3: Git history of the moved files is preserved (use `git mv`).
  PASS — `git status -s` shows `RM src/tools/readNoteTool.ts -> src/tools/builtin/readNote.ts`, same for `editNoteTool` and `createFolderTool`. `writeTools.ts` was split into two new files (expected `D` + two `??`).

- AC4: Tool IDs in the registry are unchanged post-move, verified by registry snapshot test.
  PASS — `tests/unit/toolRegistrySnapshot.test.ts` continues to assert `ids === ['append_to_note', 'create_folder', 'create_note', 'edit_note', 'read_note', 'search_vault']`. Snapshot green post-move.

## Scope coverage

- In scope "Move `src/tools/readNoteTool.ts` → `src/tools/builtin/readNote.ts`": PASS.
- In scope "Move / split `writeTools.ts` → `builtin/createNote.ts` + `builtin/appendToNote.ts`": PASS — two new files with distinct factory exports.
- In scope "Move `src/tools/editNoteTool.ts` → `src/tools/builtin/editNote.ts`": PASS.
- In scope "Leave existing `src/tools/builtin/skillTool.ts` and `src/tools/builtin/searchVault.ts` in place": PASS — untouched.
- In scope "Leave plan-mode / todo tools in `src/tools/`": PASS — `planModeTools.ts` and `todoWriteTool.ts` untouched.
- In scope "Update every import site (`src/main.ts`, `src/tools/toolRegistry.ts`, wiring modules, tests)": PASS — main.ts 5 imports swapped; userToolsLoader relocates its `isSafeVaultPath` import; editor bridge + `_fakes` swap to types; all test files updated.

## Out-of-scope audit

- Out of scope "Reshaping tool internals (F01 / F02 handle shape)": CLEAN — tool bodies unchanged except for the `writeTools.ts` split, which preserves behaviour and only separates the two factories into their own files.
- Out of scope "Renaming plan-mode / todo tools": CLEAN — untouched.
- Out of scope "Changing public tool ids": CLEAN — `read_note`, `create_note`, `append_to_note`, `create_folder`, `edit_note` all unchanged; snapshot test covers.

## QA aggregate

`qa-1.md § Verdict: PASS` — typecheck, lint, tests, build all PASS.

## Integration notes

Integration gate scanned entry points (`src/main.ts`, `manifest.json`) for anchors derived from the new public modules (`src/tools/builtin/createNote.ts`, `src/tools/builtin/appendToNote.ts`).

- `createNote.ts` exports `createCreateNoteTool`, `CreateNoteArgs`, `CreateNoteResult`. `src/main.ts` line 43 directly imports `createCreateNoteTool` from `@/tools/builtin/createNote` and calls it. HIT.
- `appendToNote.ts` exports `createAppendToNoteTool`, `AppendToNoteArgs`, `AppendToNoteResult`. `src/main.ts` line 44 imports `createAppendToNoteTool` and calls it. HIT.

Moved files (`readNote.ts`, `editNote.ts`, `createFolder.ts`) all have corresponding `import … from '@/tools/builtin/…'` lines in `src/main.ts` (lines 42, 46, 45). All reachable.

Integration gate result: PASS (no orphans, no wiring gap).

## Verdict: PASS
