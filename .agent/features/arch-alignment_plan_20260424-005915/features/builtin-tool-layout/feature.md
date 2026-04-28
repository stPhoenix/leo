# F03 — Built-in tool file layout

## Purpose

Relocate the built-in tool files into `src/tools/builtin/` with arch-spec filenames — see [context.md § Missing modules / FR-09](../../context.md#missing-modules) — so the project layout matches the architecture document and future readers can navigate by convention.

## Scope

In scope:
- Move `src/tools/readNoteTool.ts` → `src/tools/builtin/readNote.ts`.
- Move `src/tools/createFolderTool.ts` / `src/tools/writeTools.ts` → `src/tools/builtin/createNote.ts` + `src/tools/builtin/appendToNote.ts` (split by concern).
- Move `src/tools/editNoteTool.ts` → `src/tools/builtin/editNote.ts`.
- Leave existing `src/tools/builtin/skillTool.ts` and `src/tools/builtin/searchVault.ts` in place (already correct).
- Leave plan-mode / todo tools in `src/tools/` (architecture lists only read/write/search/edit under builtin).
- Update every import site (`src/main.ts`, `src/tools/toolRegistry.ts`, wiring modules, tests).

Out of scope:
- Reshaping tool internals (F01 / F02 handle shape).
- Renaming plan-mode / todo tools.
- Changing public tool ids (e.g. `read_note` stays `read_note`).

## Acceptance criteria

1. Every file listed under `src/tools/builtin/` in [architecture.md § 9](../../../../architecture/architecture.md#9-project-file-layout-proposed) exists at that exact path. (FR-09)
2. No stale imports remain; `tsc --noEmit` and the full Vitest suite pass. (NFR-01)
3. Git history of the moved files is preserved (use `git mv`). (NFR-01, process)
4. Tool IDs in the registry are unchanged post-move, verified by registry snapshot test. (NFR-01)

## Dependencies

- [../../context.md § Missing modules](../../context.md#missing-modules)
- [../../features-index.md](../../features-index.md) row F03
- No feature dependencies. Sequenced before F04 so the graph build imports stable paths.

## Implementation notes

- File-layout target — [architecture.md § 9 Project File Layout](../../../../architecture/architecture.md#9-project-file-layout-proposed) subsection `src/tools/builtin/`.
- Style rules (filename casing, export shape) — [code-style.md](../../../../standards/code-style.md).
- Commit hygiene — [best-practices.md](../../../../standards/best-practices.md).
- Project structure reference — [project-structure.md](../../../../standards/project-structure.md).

## Open questions

1. Filename casing — arch uses `readNote.ts` (lowerCamel). Confirm this matches [code-style.md](../../../../standards/code-style.md); if project codifies PascalCase for built-in tool modules, follow the code standard and update arch.md in a doc follow-up.
2. Is `appendToNote` a standalone tool or a thin wrapper over `editNote` tail append? Current code has it bundled in `writeTools.ts`. Default: split into its own file for parity with arch.
