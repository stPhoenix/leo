# Features index — arch-alignment

Ordered topologically. `deps` references feature IDs in this table only. `covers` references IDs in [context.md](context.md).

| # | id | slug | name | purpose | deps | ui-needed | priority | covers |
|---|----|------|------|---------|------|-----------|----------|--------|
| 1 | F01 | zod-tool-schema | ToolSpec — zod schema adoption | Replace `JsonSchema` + `validate` with `schema: z.ZodType`; derive JSON schema for OpenAI via `zod-to-json-schema`. | — | no | high | FR-06, NFR-01, NFR-02 |
| 2 | F02 | tool-ctx-adapters | ToolCtx — vault + editor adapters | Surface `vault: VaultAdapter` and `editor: EditorBridge` on `ToolCtx`; migrate tools off closure injection. | — | no | high | FR-07, NFR-01, NFR-02 |
| 3 | F03 | builtin-tool-layout | Built-in tool file layout | Relocate `readNoteTool.ts` etc. under `src/tools/builtin/` with arch-style filenames. | — | no | medium | FR-09, NFR-01 |
| 4 | F04 | langgraph-stategraph | AgentRunner — LangGraph StateGraph core | Add `@langchain/langgraph`; create `src/agent/graph.ts`; introduce `GraphBuilder`; route `AgentRunner.drive()` through compiled graph preserving microcompact/autocompact/plan-mode semantics. | F01, F02 | no | high | FR-01, FR-02, FR-08, FR-10, NFR-01, NFR-02, NFR-03, NFR-04 |
| 5 | F05 | graph-interrupt-confirm | Tool confirmation via graph interrupt | Replace `confirmTool` callback with `interrupt()` pause/resume inside the graph; consolidate `ConfirmationController`. | F04 | no | high | FR-03, NFR-01, NFR-04 |
| 6 | F06 | stream-event-union | Normalized StreamEvent union | Unify events reaching UI: `token\|tool_call\|tool_confirmation\|tool_result\|usage\|done\|error` per arch §4. | F05 | no | high | FR-05, NFR-01, NFR-04 |
| 7 | F07 | async-iterable-send | AgentRunner.send → AsyncIterable | Change public `send()` return type to `AsyncIterable<StreamEvent>`; migrate `ChatView` consumption + tests in same commit. | F06 | no | high | FR-04, NFR-01, NFR-05 |
| 8 | F08 | package-metadata-truth | package.json dependency truth | Declare `@langchain/langgraph`, `zod`, `zod-to-json-schema`; verify `keywords: ["langgraph"]` is now accurate. | F04 | no | low | FR-10, NFR-01 |

## Coverage check

- FR-01 → F04
- FR-02 → F04
- FR-03 → F05
- FR-04 → F07
- FR-05 → F06
- FR-06 → F01
- FR-07 → F02
- FR-08 → F04
- FR-09 → F03
- FR-10 → F04, F08
- NFR-01 → all features
- NFR-02 → F01, F02, F03, F04
- NFR-03 → F04
- NFR-04 → F04, F05, F06
- NFR-05 → F07

Every requirement mapped. No orphan features.

## Dependency graph (DAG)

```
F01 ─┐
F02 ─┼─► F04 ─► F05 ─► F06 ─► F07
F03  │    │
     │    └─► F08
     │
```

No cycles. F03 sequenced before F04 so relocated paths exist when graph code imports them.
