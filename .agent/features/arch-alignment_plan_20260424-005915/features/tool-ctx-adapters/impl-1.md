# Impl iteration 1 — F02 tool-ctx-adapters

## Summary

Lifted `vault: VaultAdapter` and `editor: EditNoteBridge` from closure injection on every built-in tool factory onto the `ToolCtx` record. `AgentRunner` now owns the IO refs (new optional `vault` and `editor` options) and plumbs them through `ToolRegistry.invoke(id, args, ctx)`. Every built-in tool reads IO from `ctx.vault` / `ctx.editor`; factories that used to take `vault` / `bridge` parameters are now nullary or keep only skill-specific dependencies. A shared test helper `tests/unit/_toolCtx.ts` centralizes ctx construction; a new guard suite asserts that no built-in tool factory re-introduces a closure-time `vault:` / `bridge:` parameter.

## Files touched

- `src/tools/types.ts` — extended `ToolCtx` with `vault: VaultAdapter` and `editor: EditNoteBridge`; moved `EditNoteBridge` interface here from `editNoteTool.ts`; imported `VaultAdapter` as a type.
- `src/tools/readNoteTool.ts` — `createReadNoteTool()` takes no arg; reads `ctx.vault`.
- `src/tools/writeTools.ts` — `createCreateNoteTool()` + `createAppendToNoteTool()` take no arg; read `ctx.vault`.
- `src/tools/createFolderTool.ts` — `createCreateFolderTool()` takes no arg; reads `ctx.vault`.
- `src/tools/editNoteTool.ts` — `EditNoteToolOptions` narrows to `{ acceptReject, logger? }`; invoke reads `ctx.editor.isActiveNote`, `ctx.editor.applyActiveEdit`, `ctx.vault.read/write/exists`; re-exports `EditNoteBridge` from types.
- `src/agent/agentRunner.ts` — added `vault?` / `editor?` options; `invokeWithConfirmation` builds ctx with those; noop fallbacks (`noopVault`, `noopEditor`) guard the case where a runner is constructed without wiring (tests that don't touch IO tools).
- `src/main.ts` — dropped `vault` / `bridge` args from every builtin tool factory call; passed `vault: vaultAdapter` and `editor: editBridge` into the `AgentRunner` constructor so production invocations of `read_note` / `create_note` / `append_to_note` / `create_folder` / `edit_note` reach the real vault and edit bridge through `ctx`.
- `src/mcp/mcpClient.ts` — unchanged by this iteration (ToolSpec shape still satisfied since F01 added `schema`).
- `src/tools/user/userToolsLoader.ts` — `invokeVaultOp` and `invokeJs` intentionally keep their `opts.vault` closure; user tool contract (author-supplied) is out of F02 scope per feature.md ("every built-in tool" list).

### Tests

- `tests/unit/_toolCtx.ts` — new. Exports `makeToolCtx(overrides)` and `noopEditor`.
- `tests/unit/toolCtxGuard.test.ts` — new (4 tests). Regex-based lint guard: built-in tools must not import `VaultAdapter` as a value, must not declare `vault:` / `bridge:` factory params, must reference `ctx.vault.*` / `ctx.editor.*` on invoke.
- `tests/unit/readNoteTool.test.ts`, `tests/unit/writeTools.test.ts`, `tests/unit/createFolderTool.test.ts`, `tests/unit/editNoteTool.test.ts` — migrated: factories called with no args; ctx built via `makeToolCtx({ vault, editor })`.
- `tests/unit/searchVault.test.ts`, `tests/unit/todoStore.test.ts`, `tests/unit/planModeTools.test.ts`, `tests/unit/mcpClient.test.ts`, `tests/unit/mcpConfirmation.test.ts`, `tests/unit/toolRegistry.test.ts`, `tests/unit/userToolsLoader.test.ts` — ctx literals replaced with `makeToolCtx(...)` calls. No assertion changes.
- `tests/unit/toolRegistrySnapshot.test.ts` — factory calls updated.
- `tests/llm/agent.live.test.ts` — dropped `vault` / `bridge` from tool factory calls; added `vault` + `editor: inactiveBridge()` options to the `AgentRunner` constructor so live tests still exercise `read_note`.

## Tests added or updated

- **New**: `tests/unit/toolCtxGuard.test.ts` — 4 regex lint tests (AC2).
- **Migrated** (fixture-only): 9 tool / registry / mcp / search / todo / plan / user-tool test files updated to use `makeToolCtx`. No behavioral assertion changes.
- **Full suite**: 1091 tests + 4 new guard tests = 1095 passing (verified via `npm test` — see qa-1.md once written).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

1. **`buildToolCtx(thread, agentId, signal)` factory not exposed as a top-level export.** Feature.md § Scope mentions "Provide a single `buildToolCtx(thread, agentId, signal)` factory in the agent layer". Shipped equivalent is `AgentRunner.invokeWithConfirmation` constructing the ctx inline with noop fallbacks, plus a test-only `makeToolCtx` helper. Rationale: only `AgentRunner` and tests build `ToolCtx` in current code — a module-level export would have no production consumer. If F04 or later introduces a second production caller, extract then.
2. **User-defined tool loader unchanged.** `userToolsLoader.invokeVaultOp` still closes over `opts.vault`. Feature.md scope lists only "every built-in tool" — user tools are phase-5 extension surface. Flagged in Open questions.

## Assumptions

1. **`EditNoteBridge` relocation is benign.** Moved from `editNoteTool.ts` to `types.ts`; re-exported from `editNoteTool.ts` to preserve public import path. No external package consumes the type yet.
2. **`noopVault` / `noopEditor` in AgentRunner are safe for tests that construct a runner without wiring IO.** Any test that actually invokes a vault/editor-touching tool must supply `vault` / `editor` via `new AgentRunner({...vault, editor...})` or via `makeToolCtx`.

## Open questions

1. **User tool loader — lift `vault` into ctx?** Preserves uniformity but expands scope beyond feature.md's enumerated tool list. Default: no.
