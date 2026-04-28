# F01 — ToolSpec zod schema adoption

## Purpose

Replace current hand-rolled `JsonSchema` + `validate` pair on [`src/tools/types.ts`](../../../../../src/tools/types.ts) with `schema: z.ZodType` to satisfy the architectural `ToolSpec` contract — see [context.md § Tool schema / FR-06](../../context.md#tool-schema). Auto-derive the OpenAI tool parameters shape via `zod-to-json-schema` so providers keep their current wire format unchanged.

## Scope

In scope:
- Add `zod` and `zod-to-json-schema` runtime dependencies.
- Add `schema: z.ZodType<TArgs>` field to `ToolSpec`.
- Provide a tiny helper that adapts a zod schema into the existing `JsonSchema` + `validate` pair during a transition window.
- Migrate each built-in tool (`readNoteTool`, `createFolderTool`, `editNoteTool`, `todoWriteTool`, `planModeTools`, `searchVault`, `skillTool`, `writeTools`) to declare its input via zod.
- Keep `toolRegistry.toOpenAITools()` output byte-compatible by round-tripping through `zod-to-json-schema`.

Out of scope:
- User-defined / MCP tool loaders (phase 5/6); cover in follow-up once host contract is decided.
- Removing the legacy `parameters: JsonSchema` field in the same PR — kept as derived-from-zod for one release cycle.

## Acceptance criteria

1. `ToolSpec.schema: z.ZodType<TArgs>` exists and is required for built-in tools. (FR-06)
2. `ToolSpec.validate(raw)` and `ToolSpec.parameters` are either removed or derived from `schema` via a single shared helper. (FR-06)
3. Every existing Vitest suite under [`tests/unit/`](../../../../../tests/unit/) passes unchanged. (NFR-01)
4. `toolRegistry.toOpenAITools(thread)` produces the same JSON structure as before migration for all built-in tools; a snapshot test covers this. (NFR-01)
5. Bundle-size delta after adding zod + zod-to-json-schema is documented in the PR description (informational, no hard cap).

## Dependencies

- [../../context.md § Tool schema](../../context.md#tool-schema)
- [../../features-index.md](../../features-index.md) row F01
- No feature dependencies.

## Implementation notes

- Contract target — [architecture.md § 4 Key Contracts](../../../../architecture/architecture.md#4-key-contracts) `ToolSpec` block.
- Module layout — [architecture.md § 9 Project File Layout](../../../../architecture/architecture.md#9-project-file-layout-proposed) under `src/tools/`.
- Test conventions — [best-practices.md](../../../../standards/best-practices.md) and [code-style.md](../../../../standards/code-style.md).
- Runtime base — [tech-stack.md](../../../../standards/tech-stack.md) governs dependency choices.

## Open questions

1. Keep `parameters: JsonSchema` as a derived property, or fully drop it? Default: keep derived during transition, drop in a follow-up.
2. Should user-defined JSON tool declarations (in `.leo/tools/`) be auto-wrapped into a permissive zod schema at load, or require users to ship zod themselves? Default: auto-wrap — users keep a JSON-first authoring story.
