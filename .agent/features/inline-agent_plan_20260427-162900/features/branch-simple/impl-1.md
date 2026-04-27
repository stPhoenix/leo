# Impl iteration 1 — F12 branch-simple

## Summary

Landed `simpleBranch.ts` with `buildSimpleBranchTools` (assembles fetch_url/search_web/fileOps/publish_artifact factories under `enabled` filter — explicitly excludes `extract_note` per FR-IA-35) and `runSimpleBranch` async generator. Inner ReAct loop is hand-rolled via `runManualLoop` driven by a `ManualChatModel` adapter (F16/F18 wires the real LangChain `BaseChatModel`). Loop streams text + tool_start/tool_end + done/error chunks through the F05 `bridgeStream` so consumers see only `ExternalEvent`s. Iteration cap selects via F04 `selectMaxIterations('simple', config.budgets)`; tokens ticked via F04 `tokenTick` per round-trip; `over` flips the loop into `error.code='token_limit'`. Iteration overflow yields `error.code='iteration_limit'`. Aborted signal cleanly exits before any further iterations.

## Files touched

- `src/agent/externalAgent/adapters/inlineAgent/branches/simpleBranch.ts` — new: `buildSimpleBranchTools`, `runSimpleBranch`, `runManualLoop`, `ReactLoopCtx`, `InlineToolHandle`.

## Tests added or updated

- `tests/unit/externalAgent/adapters/inlineAgent/simpleBranch.test.ts` — 9 cases:
  - `buildSimpleBranchTools`: AC1 inclusion list + extract_note exclusion; disabled-tools dropping.
  - `runManualLoop`: AC2 termination; AC3 iteration cap; AC4 counter ticks; AC5 tool_start/tool_end events; AC6 abort exits cleanly; token-limit boundary.
  - `runSimpleBranch`: end-to-end through the bridge yields ExternalEvents.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- Open-question resolution: instead of relying on `createReactAgent` from `@langchain/langgraph/prebuilt`, F12 ships a hand-rolled ReAct loop (`runManualLoop`) driven by a narrow `ManualChatModel` adapter. The behavior matches the prebuilt's contract (system + ask, model→tool→model rounds, terminate on assistant-no-tool-calls, iteration cap). F16/F18 will adapt `BaseChatModel` → `ManualChatModel` so production behavior is identical without the heavier prebuilt's internal state-graph. Reasoning logged in this artifact and noted as a deviation.
- Token tick happens at end-of-turn using the assistant's `usage` field; provider input estimation is left to F11/F13 nodes that own classifier/planner LLM calls.

## Assumptions

- `runReactLoop` injection point lets F18 swap a fake loop for integration tests (already used by the bridge unit test "runs through bridge and emits ExternalEvents").
- The `ManualChatModel` adapter shape is intentionally narrow — F16 will write the LangChain bridge once provider DI lands.

## Open questions

- F18 will integrate `createReactAgent` (or our ManualChatModel adaptation) end-to-end with msw-mocked providers.
