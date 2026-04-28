# F14 — Research step node

## Purpose

Build the per-step `researchStep` node: a bounded `createReactAgent` over the multistep tool subset (`search_web`, `fetch_url`, `read_file`, `write_file`, `list_dir`, `delete_file`, `extract_note` — **excluding** `publish_artifact`). Tracks `tool_call_id → noteId` consumption to drive the F10 `messageRewriter`, computes the per-step iteration budget via F04 `perStepBudget` with rollover, drops raw tool messages at the step boundary, and exits cleanly when the per-step budget is exhausted (notes intact, advances to next step). Covers FR-IA-38 and FR-IA-41 (the per-step orchestration that consumes F04 + F10 helpers); the F10 mechanism portion of FR-IA-39 is glued in here.

## Scope

In scope:
- `src/agent/externalAgent/adapters/inlineAgent/multistep/researchStep.ts` exporting:
  - `async *runResearchStep({ providerFactory, config, runState, sandbox, signal, logger, planStep, stepIndex, perStepIterations }): AsyncIterable<ExternalEvent>`.
  - Builds tool list excluding `publish_artifact`; `extract_note` mandatory.
  - `createReactAgent` with the step's bounded budget; emits text deltas + tool logs via F05.
  - Bookkeeping: maintain `consumedRefs: Map<tool_call_id, noteId>`. When `extract_note` is called, look up the immediately preceding consumed tool result via the LangGraph message history and add the pair.
  - Apply F10 `rewriteConsumedToolResults` to the model's input on each subsequent invocation within the step (replace consumed tool-result message with `[discarded — see note <id>]` stub).
  - On step exit (assistant message without tool call OR per-step iteration cap): apply F10 `dropRawToolMessagesAtStepBoundary` to the messages handed forward into the next step.
  - Per-step cap exhaustion → step terminates with notes intact; emit `log info { node: 'researchStep', stepIndex, status: 'iteration_limit' }` and advance.
  - Increment `runState.iterations` per round-trip; recompute next step's `perStepIterations` via `perStepBudget` from F04 (rollover).
  - Cumulative `runState.iterations` reaches `selectMaxIterations('multistep', config)` → bubble up `error.code = 'iteration_limit'` to the caller (graph).

Out of scope:
- Synthesize node — F15.
- Plan generation — F13.
- Top-level loop driving N steps — F16 wires the loop.

## Acceptance criteria

1. Research-step tool list contains `search_web, fetch_url, read_file, write_file, list_dir, delete_file, extract_note`. **Excludes `publish_artifact`** ([context.md#fr-ia-38](../../context.md#functional-requirements)).
2. `extract_note` consumption → next model invocation receives the `[discarded — see note <id>]` stub in place of the consumed tool result ([context.md#fr-ia-39](../../context.md#functional-requirements)).
3. At step boundary, all raw tool / tool-result messages dropped; only system + ask + notes summary + scratchpad survive ([context.md#fr-ia-39](../../context.md#functional-requirements)).
4. Per-step iteration budget = `floor(remainingIterations / remainingSteps)` recomputed per step start, with rollover ([context.md#fr-ia-41](../../context.md#functional-requirements)).
5. Per-step cap mid-step → step terminates, notes intact, advance to next step (do not abort run) ([context.md#fr-ia-41](../../context.md#functional-requirements)).
6. Cumulative `multistep` iteration cap → bubble `iteration_limit` to graph; partial artifacts (none from research-step) flushed by graph anyway ([context.md#fr-ia-42](../../context.md#functional-requirements)).
7. Each step emits one `log info { node: 'researchStep', stepIndex, status, durationMs }` on exit (no `text` events from this metadata log).

## Dependencies

- [F04 — run state + budgets](../run-state-budgets/feature.md) — `perStepBudget`, counters.
- [F05 — event bridge](../event-bridge/feature.md).
- [F06](../tool-fetch-url/feature.md), [F07](../tool-search-web/feature.md), [F08](../tool-file-ops/feature.md) — tool factories.
- [F10 — extract_note + rewriter](../tool-extract-note/feature.md).
- [F13 — planner](../multistep-planner/feature.md) — provides `plan`.
- [context.md#fr-ia-38](../../context.md#functional-requirements), [context.md#fr-ia-39](../../context.md#functional-requirements), [context.md#fr-ia-41](../../context.md#functional-requirements).

## Implementation notes

- LangGraph + ReAct prebuilt patterns: [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) §"LangGraph / Agent Layer".
- Async / signal threading + finally: [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) §"Async & Concurrency".
- Best-practices: typed `Result` via tools; do not throw across step boundary ([`.agent/standards/best-practices.md`](../../../../.agent/standards/best-practices.md) §"Core Principles").

## Open questions

- How does `createReactAgent` expose interception of the `messages` array between iterations? May need to convert to a hand-rolled ReAct sub-loop here to apply rewrites mid-step. Decide during implementation; preserve OD-IA-1 hybrid choice.
- Does the LangChain message API permit replacing `tool_call_id`-bearing messages without breaking the next assistant turn's structured tool linkage? Verify against `@langchain/core/messages` types.
- Token tick within `createReactAgent` — same concern as F12. Pursue identical mechanism.
