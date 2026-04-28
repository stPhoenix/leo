# Impl iteration 1 — F01 zod-tool-schema

## Summary

Adopted zod as the primary input schema on `ToolSpec`. Added a shared adapter (`src/tools/zodAdapter.ts`) exposing `jsonSchemaFromZod` (built on zod v4 `z.toJSONSchema`, `target: 'openapi-3.0'`) and `validateFromZod`. Every built-in tool now authors its input schema in zod; `parameters: JsonSchema` and `validate: ToolValidate` are derived from that single source via the adapter. User-defined and MCP tools keep their author-supplied JSON schema and are satisfied with a permissive pass-through zod at the type level. All 1079 pre-existing tests pass unchanged; two new suites (15 tests) cover the adapter and the OpenAI tools snapshot.

## Files touched

- `package.json` — added runtime dep `zod@4.3.6`.
- `src/tools/zodAdapter.ts` — new: `jsonSchemaFromZod`, `validateFromZod`.
- `src/tools/types.ts` — added `readonly schema: z.ZodType<TArgs>` field to `ToolSpec`; imported `z` type-only.
- `src/tools/readNoteTool.ts` — migrated to zod (`ReadNoteSchema`).
- `src/tools/writeTools.ts` — migrated `create_note` + `append_to_note` to zod.
- `src/tools/createFolderTool.ts` — migrated to zod.
- `src/tools/editNoteTool.ts` — migrated to zod with cross-field refine `line_end >= line_start`.
- `src/tools/todoWriteTool.ts` — migrated `TodoWrite` to zod with nested `TodoSchema`; removed dependency on `validateTodo` for primary validation (still exported by `todoStore` for other callers).
- `src/tools/planModeTools.ts` — migrated `EnterPlanMode` + `ExitPlanMode` to zod.
- `src/tools/builtin/searchVault.ts` — migrated to zod.
- `src/tools/builtin/skillTool.ts` — added `schema: SkillToolSchema` for shape; validator kept as custom because registry lookup + sentinel checks aren't pure-zod.
- `src/tools/user/userToolsLoader.ts` — user-defined tools now carry `schema: permissiveUserSchema` (`z.record(z.string(), z.unknown())`); authored `parameters` JSON unchanged.
- `src/mcp/mcpClient.ts` — MCP tools now carry `schema: mcpPermissiveSchema` (`z.unknown()`); authored `parameters` JSON from server unchanged.
- `tests/unit/toolRegistry.test.ts` — stub tool fixture adds `schema`.
- `tests/unit/agentRunner.test.ts` — inline tool fixtures add `schema`.
- `tests/unit/agentRunner.microcompact.test.ts` — `fakeReadNoteSpec` adds `schema`.
- `tests/unit/userToolsLoader.test.ts` — registry prefill adds `schema`.
- `tests/unit/wireUserTools.test.ts` — pre-registered collision fixture adds `schema`.

## Tests added or updated

- `tests/unit/zodAdapter.test.ts` — new (6 tests). Covers: OpenAI-shape output, constraint propagation (`minLength`, `enum`), validator success, refine-message passthrough, non-object rejection, empty-issues fallback. (AC1, AC2)
- `tests/unit/toolRegistrySnapshot.test.ts` — new (6 tests). Covers: exhaustive list of built-in tools exposed via `toOpenAITools()`, function-wrapper invariants, per-tool required fields, description preservation, `search_vault` optional-tags shape. (AC4)
- `tests/unit/toolRegistry.test.ts` — stub tool adds `schema` so the `ToolSpec<...>` constructor remains representative. (AC1)
- `tests/unit/agentRunner.test.ts`, `tests/unit/agentRunner.microcompact.test.ts`, `tests/unit/userToolsLoader.test.ts`, `tests/unit/wireUserTools.test.ts` — fixture updates only; no assertion changes. (AC3)

All existing tool unit tests (`readNoteTool.test.ts`, `editNoteTool.test.ts`, `writeTools.test.ts`, `createFolderTool.test.ts`, `todoWriteTool.test.ts`, `planModeTools.test.ts`, `searchVault.test.ts`, `skillTool.test.ts`, `userToolsLoader.test.ts`, `wireUserTools.test.ts`, `toolRegistry.test.ts`) pass unchanged — specific error-message assertions (`'unsafe path'`, `'plan must be a string'`) are preserved because the zod schema's first issue message is carefully mapped to those strings via `.refine(fn, 'unsafe path')` and `.string({ error: 'plan must be a string' })`.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

1. **Dropped `zod-to-json-schema` dep mid-install.** Feature.md proposed adding both `zod` and `zod-to-json-schema`. On install I discovered zod v4 ships `z.toJSONSchema(schema, { target: 'openapi-3.0' })` natively, making `zod-to-json-schema` redundant. Removed the package with `pnpm remove zod-to-json-schema`. Net effect: strictly smaller bundle and one fewer dep to track. `jsonSchemaFromZod` is the rename of the helper that wraps the built-in. **This change is semantically in scope of FR-06** — the contract is "derive JSON schema from zod", not "use the `zod-to-json-schema` package".
2. **`parameters` kept as a required derived field rather than removed.** Feature.md AC2 allowed either "removed or derived". Chose derived via the shared adapter so `ToolRegistry.toOpenAITools()` (the OpenAI wire path) and `ToolRegistry.invoke()` (the validate path) don't need a register-time transformation step and keep byte-compatible authored JSON for the user- and MCP-tool paths.
3. **Skill tool retains a custom `validate`** (not derived from zod). Its validation runs `SkillRegistry.findSkill`, inspects `disableModelInvocation`, and checks `type === 'prompt'` — side-effectful registry reads that zod can't express. The tool still exposes a pure zod `schema` for the LLM-side contract; validation splits into zod shape + registry lookup. Flagged with a comment in the source.

## Assumptions

1. **Zod v4 API is stable for our use.** `z.toJSONSchema`, `z.int()`, `z.enum`, `z.object(...).strict()`, `.describe()`, `.refine()`, custom `error` per-type — all from v4.3.6. Upgrade guard: the pinned caret range should not let a future minor break output shape without a test failure (the snapshot suite covers structure).
2. **The OpenAI target for JSON-schema output matches what LM Studio / Anthropic / OpenAI all accept.** Prior hand-rolled schemas used the same `{type:'object', properties, required, additionalProperties:false}` shape, which zod with `target:'openapi-3.0'` reproduces. If a provider rejects extra fields like `minLength`, we revisit — but `minLength` is a standard JSON-schema keyword.
3. **Bundle-cost escalation is user-accepted.** Q4 was formally overridden to option (b) per [decisions.md § Gate questions](../../decisions.md#gate-questions); zod ships.

## Open questions

None blocking F02/F03. Deferred items:
1. Should `validateTodo` in `src/agent/todoStore.ts` now delegate to the zod schema from `todoWriteTool.ts` (one source of truth) or stay independent? Current code keeps both; no test exercises a divergence. Candidate for a follow-up.
2. For user- and MCP-tool `schema`, is the permissive zod pass-through a lie-by-convention? It satisfies the type but never actually validates. Alternative: generate a real zod from the authored JSON schema at load time. Cost: extra runtime complexity + risk of subtle behavior change. Deferred.
