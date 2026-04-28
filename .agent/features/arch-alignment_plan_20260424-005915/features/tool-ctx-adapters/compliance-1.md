# Compliance iteration 1 — F02 tool-ctx-adapters

## Acceptance criteria

- AC1: `ToolCtx` has required `vault` and `editor` fields matching the architecture §4 ToolCtx signature.
  PASS — `src/tools/types.ts` declares `readonly vault: VaultAdapter;` and `readonly editor: EditNoteBridge;` on `ToolCtx`. Both required. `EditNoteBridge` was lifted to the same file; it matches the narrow "editor for active-note edits" role described by the architecture §4 `ToolCtx.editor: EditorBridge` field (typed as the narrower edit-capable interface — see impl-1.md § Assumptions #1).

- AC2: No built-in tool imports vault or editor from module scope; all IO flows through `ctx`. Verified by a grep guard in a lint test.
  PASS — `tests/unit/toolCtxGuard.test.ts` enforces four regex assertions:
    1. No `import { VaultAdapter }` value import in any built-in tool file.
    2. No `createXxxTool(...)` factory signature accepts `vault:` or `bridge:`.
    3. `edit_note` reads `ctx.editor.isActiveNote` + `ctx.editor.applyActiveEdit`.
    4. `read_note` / `create_note` / `append_to_note` / `create_folder` all reference `ctx.vault.*`.
  All four pass.

- AC3: Existing integration tests for `read_note`, `edit_note`, `create_note`, `append_to_note`, `search_vault` pass without behavioral change.
  PASS — full suite green in `qa-1.md` (1095 tests; `readNoteTool.test.ts`, `writeTools.test.ts`, `editNoteTool.test.ts`, `createFolderTool.test.ts`, `searchVault.test.ts` all pass after migrating to `makeToolCtx`). No assertion text or behavior changes; only the ctx construction shape changed.

- AC4: Tool failures still convert to `ToolResult{ok:false}` with no regression in edit-lock release (SRS NFR-REL-04).
  PASS — `edit_note` reject path still calls `commitResult.revert()` in a `try/catch` (editNoteTool.ts:167–189), and `ctx.editor.applyActiveEdit` is responsible for lock acquire/release via `createActiveNoteEditBridge` → `withLock` (activeNoteEditBridge.ts:90–99). That file is unchanged by F02; the bridge still owns lock semantics. Existing `editNoteTool.test.ts` cases "Reject on the vault fallback path restores pre-edit bytes" and "Reject on the active-editor path calls undo() exactly once" both pass.

## Scope coverage

- In scope "Extend ToolCtx in `src/tools/types.ts` with `vault` and `editor`": PASS — types.ts change applied.
- In scope "Provide a single `buildToolCtx(thread, agentId, signal)` factory in the agent layer that plumbs current adapters in": PARTIAL — shipped as inline construction inside `AgentRunner.invokeWithConfirmation` (which already had the equivalent ctx-building logic) plus a test helper `tests/unit/_toolCtx.ts → makeToolCtx`. Rationale in impl-1.md § Deviations #1: a top-level export has no production consumer until F04+. Not a failure; documented deviation.
- In scope "Migrate every built-in tool to read its IO from ctx, not from an imported singleton": PASS — `readNoteTool`, `writeTools`, `createFolderTool`, `editNoteTool`, `builtin/searchVault`, `builtin/skillTool`, `todoWriteTool`, `planModeTools` all audited by `toolCtxGuard.test.ts`. `searchVault` / `skillTool` / `todoWriteTool` / `planModeTools` do not perform vault/editor IO — they already had no vault/bridge closure; guard vacuously passes for them.
- In scope "Update `AgentRunner.invokeWithConfirmation` (agentRunner.ts:474) to call the factory": PASS — agentRunner.ts now builds ctx with `vault: this.vault ?? noopVault`, `editor: this.editor ?? noopEditor`.
- In scope "Update test doubles in `tests/unit/` to pass fake vault/editor adapters": PASS — shared `makeToolCtx` + `noopEditor` in `tests/unit/_toolCtx.ts`; 10+ test files migrated.

## Out-of-scope audit

- Out of scope "Introducing a DI container": CLEAN — no container added; factory is a plain function (helper-only).
- Out of scope "Renaming current Vault / Editor wrapper types": CLEAN — `VaultAdapter` unchanged; `EditorBridge` class unchanged; `EditNoteBridge` interface relocated (value-preserving) with re-export.
- Out of scope "MCP / user-defined tool loaders": CLEAN — MCP registers with permissive `z.unknown()` schema (F01 carryover). User loader invoke path unchanged.

## QA aggregate

`qa-1.md § Verdict: PASS` — typecheck, lint, tests (1095), build all PASS.

## Integration notes

Integration gate scanned entry points (`src/main.ts`, `manifest.json`) for anchors from this iteration's new public files:

- `tests/unit/_toolCtx.ts` — test-only, skipped (path contains `/tests/`).
- `tests/unit/toolCtxGuard.test.ts` — test-only, skipped.

No new production source files created (F02 is a refactor + relocation + new option fields on existing classes). `main.ts` was audited and directly sets both `vault: vaultAdapter` and `editor: editBridge` on `new AgentRunner({...})` (main.ts:543–544), so the runtime wiring is concrete, not deferred. The feature is end-to-end live.

## Verdict: PASS
