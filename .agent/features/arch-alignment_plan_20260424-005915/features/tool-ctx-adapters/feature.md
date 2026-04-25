# F02 — ToolCtx vault + editor adapters

## Purpose

Surface `vault: VaultAdapter` and `editor: EditorBridge` on `ToolCtx` per the architectural contract — see [context.md § Tool schema / FR-07](../../context.md#tool-schema) — so tool implementations receive their IO capabilities uniformly through ctx instead of via module-scope closures.

## Scope

In scope:
- Extend `ToolCtx` in [`src/tools/types.ts`](../../../../../src/tools/types.ts) with `vault` and `editor`.
- Provide a single `buildToolCtx(thread, agentId, signal)` factory in the agent layer that plumbs current adapters in.
- Migrate every built-in tool (`readNoteTool`, `editNoteTool`, `createFolderTool`, `writeTools`, `searchVault`, `skillTool`, `planModeTools`, `todoWriteTool`) to read its IO from ctx, not from an imported singleton.
- Update `AgentRunner.invokeWithConfirmation` (agentRunner.ts:474) to call the factory.
- Update test doubles in [`tests/unit/`](../../../../../tests/unit/) to pass fake vault/editor adapters.

Out of scope:
- Introducing a DI container; the factory is a plain function.
- Renaming current `Vault` / `Editor` wrapper types — keep their identity.
- MCP / user-defined tool loaders — separate pass.

## Acceptance criteria

1. `ToolCtx` has required `vault` and `editor` fields matching the [architecture §4 ToolCtx signature](../../../../architecture/architecture.md#4-key-contracts). (FR-07)
2. No built-in tool imports vault or editor from module scope; all IO flows through `ctx`. Verified by a grep guard in a lint test. (FR-07)
3. Existing integration tests for `read_note`, `edit_note`, `create_note`, `append_to_note`, `search_vault` pass without behavioral change. (NFR-01)
4. Tool failures still convert to `ToolResult{ok:false}` with no regression in edit-lock release (SRS NFR-REL-04). (NFR-01)

## Dependencies

- [../../context.md § Tool schema](../../context.md#tool-schema)
- [../../features-index.md](../../features-index.md) row F02
- No feature dependencies. Safe to merge in parallel with F01 but the factory must not hide zod migration.

## Implementation notes

- Contract target — [architecture.md § 4 ToolCtx](../../../../architecture/architecture.md#4-key-contracts).
- Adapter boundary rules — [architecture.md § 1 "Pure core, IO at edges"](../../../../architecture/architecture.md#1-architectural-principles).
- File locations — [architecture.md § 9](../../../../architecture/architecture.md#9-project-file-layout-proposed).
- Style — [code-style.md](../../../../standards/code-style.md).
- Testing conventions — [best-practices.md](../../../../standards/best-practices.md).

## Open questions

1. Should `editor: EditorBridge` be optional (nullable) when no active note is present? Default: required field, expose noop methods on the bridge for the no-active-note case.
2. Does `ToolCtx.vault` expose the full `VaultAdapter` surface or a narrowed subset per-tool? Default: full surface; rely on types at call sites.
