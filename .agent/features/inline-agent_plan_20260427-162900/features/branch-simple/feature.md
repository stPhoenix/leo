# F12 — Simple branch

## Purpose

Build the `simpleBranch` node — instantiates `createReactAgent` (from `@langchain/langgraph/prebuilt`) with the configured `ChatModel` and the inline tool list **excluding** `extract_note`. Streams text deltas and tool-call logs through the F05 event bridge, increments iteration / token counters, terminates on assistant message without tool calls (→ `publishArtifacts` → `done`), or surfaces `error.code = 'iteration_limit'` while still flushing partial artifacts. Covers FR-IA-35, FR-IA-36.

## Scope

In scope:
- `src/agent/externalAgent/adapters/inlineAgent/branches/simpleBranch.ts` exporting:
  - `async *runSimpleBranch({ providerFactory, config, runState, sandbox, refinedAsk, systemPrompt, signal, logger }): AsyncIterable<ExternalEvent>`.
  - Builds tool list from F06 (`fetch_url`), F07 (`search_web`), F08 (`read_file`, `write_file`, `list_dir`, `delete_file`), F09 (`publish_artifact`) — filtered by `config.tools.*.enabled`. **Excludes `extract_note`** ([context.md#fr-ia-35](../../context.md#functional-requirements)).
  - `createReactAgent` instantiated with `prompt: systemPrompt + inlineSystemPrompt` (composition rule per [F02](../config-schema/feature.md)).
  - Streams via `streamMode: 'messages'`; bridge through [F05](../event-bridge/feature.md) `bridgeStream`.
  - Increments `runState.iterations` per round-trip; `runState.cumulativeTokens` per F04 `tokenTick`.
  - Iteration cap from F04 `selectMaxIterations('simple', config)`.
  - Termination: assistant message without tool calls → exit normally; downstream graph node calls `flushPublishedArtifacts` (F09) then emits `done`.
  - Cap-hit: surface `{ type: 'error', error: { code: 'iteration_limit' } }`; downstream graph still flushes any nominated artifacts before terminating ([context.md#fr-ia-36](../../context.md#functional-requirements)).
- Unit tests: tool list excludes `extract_note`; iteration cap fires and partial artifacts still flushed; assistant-no-tool-call termination produces no spurious events; abort during streaming exits within ≤2 s and runs cleanup (verified via mock signal); per-call signal threading.

Out of scope:
- Recursion guard assertion — F16 owns the assembly-time check that no `delegate_external` is in the list.
- Multistep nodes — F13/F14/F15.
- Top-level graph wiring — F16.

## Acceptance criteria

1. `simpleBranch` tool list **excludes** `extract_note`; includes all other tools whose `enabled === true` ([context.md#fr-ia-35](../../context.md#functional-requirements)).
2. Termination on assistant message with no tool calls; downstream graph routes to `publishArtifacts` then `done` ([context.md#fr-ia-36](../../context.md#functional-requirements)).
3. Cumulative iteration cap (`selectMaxIterations('simple', config)`) hit → emit `{ type: 'error', error: { code: 'iteration_limit' } }`; the graph still flushes prior nominations ([context.md#fr-ia-36](../../context.md#functional-requirements)).
4. Each round-trip increments `runState.iterations`; tokens ticked via F04 helper.
5. Stream chunks emit `text` events only (per F05); tool-call start/end logs per F05 elision rules.
6. `signal` threaded into `ChatModel.stream` and into every tool `invoke` call.

## Dependencies

- [F01](../adapter-scaffold/feature.md), [F02](../config-schema/feature.md), [F04](../run-state-budgets/feature.md), [F05](../event-bridge/feature.md), [F06](../tool-fetch-url/feature.md), [F07](../tool-search-web/feature.md), [F08](../tool-file-ops/feature.md), [F09](../tool-publish-artifact/feature.md).
- `@langchain/langgraph/prebuilt` `createReactAgent`.
- [context.md#fr-ia-35](../../context.md#functional-requirements), [context.md#fr-ia-36](../../context.md#functional-requirements).

## Implementation notes

- LangChain subpath imports for tree-shaking: [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) §"LangGraph / Agent Layer".
- Stream + abort patterns: [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) §"Async & Concurrency".
- Tech-stack note on `createReactAgent`: see hybrid-graph rationale at [context.md#open-questions](../../context.md#open-questions) (OD-IA-1).

## Open questions

- Does `createReactAgent` re-emit tool messages back into the stream chunks? If so, does the F05 bridge double-log? Verify integration shape during implementation.
- How to surface partial-flush ordering when the iteration cap fires inside a tool call (vs after assistant message)? Lean: capture exit reason, drain pending tool result, then run flush.
- Token usage accounting for `createReactAgent` — usage is on each model response. Confirm we can intercept via `callbacks` or by reading `response_metadata` on each emitted message.
