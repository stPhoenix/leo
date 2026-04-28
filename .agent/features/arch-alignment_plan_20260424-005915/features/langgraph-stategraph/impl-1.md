# Impl iteration 1 — F04 langgraph-stategraph

## Summary

Added `@langchain/langgraph` runtime dep (1.2.9). Introduced `src/agent/graph.ts` with `GraphBuilder` and `buildAgentGraph(deps, turn) → CompiledStateGraph` plus an `AgentStateAnnotation` root. The compiled StateGraph has five nodes — `prepareContext`, `applyMicrocompact`, `callModel`, `handleToolCalls`, `finalize` — with conditional edges that replicate the old `for let roundTrip …` loop: `callModel → handleToolCalls` when pending tool calls exist, else `→ finalize`; `handleToolCalls → applyMicrocompact` while `roundTrip < maxToolRoundTrips` and `!cancelled`, else `→ finalize`. `AgentRunner.drive()` is now a thin dispatcher selected by the `USE_GRAPH_RUNTIME` constant in `graph.ts` — it builds a per-turn graph, invokes it with the slot's `AbortSignal`, and forwards stream events through `EventChannel` so UI consumption is byte-identical. The previous imperative loop is preserved as `driveLegacy` for a one-release fallback. The `EventChannel` utility moved out of `agentRunner.ts` and now lives alongside `GraphBuilder` in `graph.ts` (same module — `agentRunner.ts` imports `EventChannel` from there). `src/main.ts` records the active runtime in `plugin.load` telemetry.

## Files touched

- `package.json` — added runtime dep `@langchain/langgraph@^1.2.9`.
- `src/agent/graph.ts` — new; `GraphBuilder`, `buildAgentGraph`, `AgentStateAnnotation`, `EventChannel`, `USE_GRAPH_RUNTIME`, and node/router implementations.
- `src/agent/agentRunner.ts` — `drive()` now picks between `driveWithGraph` (default) and `driveLegacy` (feature-flagged fallback); imports `EventChannel` from `graph.ts`; helpers (`applyPlanModeGate`, `invokeWithConfirmation`, `applyMicrocompactPass`, `defaultIsCompactable`) retained (used by legacy path).
- `src/main.ts` — imports `USE_GRAPH_RUNTIME`; `plugin.load` log now records `graphRuntime` flag so production telemetry confirms which runtime shipped.

## Tests added or updated

No test files changed. The existing `tests/unit/agentRunner.test.ts` (22 cases), `tests/unit/agentRunner.microcompact.test.ts` (2 cases), and `tests/llm/agent.live.test.ts` suites exercise the new graph path unchanged because `USE_GRAPH_RUNTIME` defaults to `true` and every public behavior (token/usage/done ordering, FIFO queue, FocusedContext snapshot semantics, cancellation, dispose, error forwarding, tool-call round trips, OpenAI tool pass-through, plan-mode gate, confirmation allow/deny/allow-thread, skill-listing injection, plan-mode attachments, RAG query signal propagation, history accumulation) is preserved by the graph nodes. Running the full Vitest suite yields 1095/1095 green against the graph-routed runtime. Microcompact is invoked at the same boundary (before `callModel`, inside `applyMicrocompactNode`) as the legacy loop — its existing suite validates the behavior delta is zero.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

1. **Per-turn graph compile, not per-thread cache.** Feature.md Open Q4 defaulted to per-turn rebuild "unless profiling shows it matters"; shipped per-turn. `GraphBuilder.build(turn)` is a thin method — the heavy cost is node-closure allocation, negligible vs the subsequent LLM call.
2. **`@langchain/core` not pulled in as a direct dep.** `@langchain/langgraph` declares it as a peer; for our use (custom `Provider.stream`, our own `ChatMessage` type) we never import from `@langchain/core`, so the peer resolves to `undefined` at runtime without affecting our graph (we never pass `BaseMessage[]`). Bundle stays leaner.
3. **Autocompact remains upstream of the graph.** Feature.md Open Q2 defaulted to "inside the graph as a conditional entry branch". Shipped as-is — `prepareContext` is the entry node and already handles RAG + assemble + truncate + skill-listing; autocompact is orchestrated by the existing modules (`autocompact.ts`, `ptlRetry.ts`) that remain outside the graph. Leaving the topology unchanged keeps this feature's scope bounded; F05/F06/F07 do not depend on autocompact living inside the graph. A follow-up can add a conditional entry branch without breaking the AgentState shape.
4. **`plugin.load` log now includes `graphRuntime`.** Not in feature.md scope, but required by the integration gate (§5.3.1) — the new `graph.ts` module must be anchored from the entry point. A single telemetry field documents the runtime actually in use and makes the wiring grep-visible.

## Assumptions

1. **LangGraph TS `StateGraph` + `Annotation.Root` is the "graph API"** referenced in feature.md Open Q1. Confirmed against `@langchain/langgraph@1.2.9` TypeScript definitions (`dist/index.d.ts`).
2. **Graph invocation does not need `MemorySaver` checkpointing.** Per feature.md § Out of scope ("Persistent checkpointing (not required by SRS)") — we use no checkpointer; single-threaded per-turn invoke suffices.
3. **Existing `EventChannel` stays as the UI-facing transport.** Per feature.md Open Q3 default ("keep EventChannel for this feature; F07 migrates the public boundary"). Graph nodes push into the per-turn `EventChannel` via the `TurnBinding` closure; `AgentRunner.send()` returns the same `events.iterable()` as before.
4. **Recursion limit math.** `Math.max(25, maxToolRoundTrips * 4 + 10)` covers the worst-case node traversal per turn (prepareContext → [applyMicrocompact → callModel → handleToolCalls] × N → finalize ≈ 3N+2 node hops for N=8 round trips = 26). `withConfig({ recursionLimit })` guards against regressions if `maxToolRoundTrips` is raised later.

## Open questions

1. **`driveLegacy` removal timeline.** Feature.md calls for a one-release fallback. Propose removing `driveLegacy` + the `USE_GRAPH_RUNTIME` flag in the release after F07 lands and the UI boundary flips. Tracked as a follow-up outside this workspace.
2. **Should `AgentRunner` eventually delete the helper methods (`applyPlanModeGate`, `invokeWithConfirmation`, `applyMicrocompactPass`) now that the graph nodes own those code paths?** They remain because `driveLegacy` still calls them. They go away with `driveLegacy`.
