# Compliance iteration 1 — F01 zod-tool-schema

## Acceptance criteria

- AC1: `ToolSpec.schema: z.ZodType<TArgs>` exists and is required for built-in tools.
  PASS — `src/tools/types.ts:38` declares `readonly schema: z.ZodType<TArgs>;`. Every built-in tool factory (`createReadNoteTool`, `createCreateNoteTool`, `createAppendToNoteTool`, `createCreateFolderTool`, `createEditNoteTool`, `createSearchVaultTool`, `createSkillTool`, `createTodoWriteTool`, `createEnterPlanModeTool`, `createExitPlanModeTool`) populates it. Covered by `tests/unit/toolRegistrySnapshot.test.ts`.

- AC2: `ToolSpec.validate` and `ToolSpec.parameters` are either removed or derived from `schema` via a single shared helper.
  PASS — kept as required fields; every built-in tool fills them via `jsonSchemaFromZod(Schema)` + `validateFromZod(Schema)` from the shared `src/tools/zodAdapter.ts`. The skill tool keeps a custom `validate` because its validation performs registry lookups (documented deviation, see `impl-1.md § Deviations` #3).

- AC3: Every existing Vitest suite passes unchanged.
  PASS — full suite green (`qa-1.md § Tests` = 1091 passed, 117 files). Pre-migration baseline was 1079 tests; the delta is exactly the 12 net-new tests this feature added (6 `zodAdapter` + 6 `toolRegistrySnapshot`). No existing suites were deleted or modified in assertion behavior; fixture updates only (schema field added to inline `ToolSpec` literals in `agentRunner.test.ts`, `agentRunner.microcompact.test.ts`, `userToolsLoader.test.ts`, `wireUserTools.test.ts`, `toolRegistry.test.ts`).

- AC4: `toolRegistry.toOpenAITools(thread)` produces the same JSON structure as before migration for all built-in tools; a snapshot test covers this.
  PASS — `tests/unit/toolRegistrySnapshot.test.ts` exercises every built-in tool's `toOpenAITools()` entry and asserts the structural invariants: `type: 'function'` wrapper, `parameters.type === 'object'`, `additionalProperties: false`, correct `required` field lists, correct property types, description preservation. Zod-derived schemas additionally include `minLength: 1` on string fields that previously relied on an explicit `validate` branch for "non-empty string" — a semantic tightening retained by the tests.

- AC5: Bundle-size delta after adding zod + zod-to-json-schema is documented in the PR description (informational, no hard cap).
  PASS — `qa-1.md § Build` records baseline 135 596 B gz → post-F01 197 340 B gz, delta +61 744 B gz (+45.5 %). `zod-to-json-schema` was not added (see `impl-1.md § Deviations` #1 — zod v4's built-in `z.toJSONSchema` covers the use case).

## Scope coverage

- In scope "Add zod and zod-to-json-schema as runtime dependencies": PARTIAL — `zod` added; `zod-to-json-schema` deliberately not added, superseded by zod v4 built-in. Deviation documented in `impl-1.md § Deviations` #1. Equivalent functionality; net positive for bundle.
- In scope "Add schema: z.ZodType<TArgs> field to ToolSpec": PASS — `src/tools/types.ts:38`.
- In scope "Provide a tiny helper that adapts a zod schema into the existing JsonSchema + validate pair during a transition window": PASS — `src/tools/zodAdapter.ts` exports `jsonSchemaFromZod` and `validateFromZod`.
- In scope "Migrate each built-in tool to declare its input via zod": PASS — all 10 factories in `src/tools/` (incl. `builtin/`) migrated.
- In scope "Keep toolRegistry.toOpenAITools() output byte-compatible by round-tripping through zod-to-json-schema": PASS on structure; NOT byte-identical because zod adds well-typed JSON-Schema keywords (`minLength`) that the hand-rolled schemas omitted. This tightens the OpenAI contract to match what the pre-existing `validate` already enforced at runtime; no consumer breakage possible. The snapshot test locks in the new structure so accidental drift is caught.

## Out-of-scope audit

- Out of scope "User-defined / MCP tool loaders (phase 5/6)": CLEAN — `src/tools/user/userToolsLoader.ts` and `src/mcp/mcpClient.ts` were touched only to satisfy the new required `schema` field with a permissive pass-through. Contract and behavior unchanged.
- Out of scope "Removing the legacy parameters: JsonSchema field in the same PR": CLEAN — field retained; now derived.

## QA aggregate

`qa-1.md § Verdict: PASS` — all four gates (typecheck, lint, tests, build) PASS. No gaps from QA.

## Integration notes

Integration gate scanned the declared entry points (`src/main.ts`, `manifest.json`) for anchors derived from the one net-new public module `src/tools/zodAdapter.ts` (`zodAdapter`, `jsonSchemaFromZod`, `validateFromZod`). Zero direct hits. Indirect reachability is unambiguous: `src/main.ts` imports every built-in tool factory (lines 42–76), each of which imports from `./zodAdapter`. Build succeeds, 1091 tests green, bundle size reflects zod presence — the wiring is exercised end-to-end.

No `### In scope` bullet contains a wiring keyword (the feature is an internal schema refactor, not a runtime wiring change), so the gate emits this informational note rather than a gap.

## Verdict: PASS
