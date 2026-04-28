# F04 — AgentRunner LangGraph StateGraph core

## Purpose

Route `AgentRunner.drive()` through a compiled LangGraph `StateGraph` and introduce the `GraphBuilder` module — see [context.md § Runtime orchestration / FR-01, FR-02, FR-08](../../context.md#runtime-orchestration) and [context.md § Missing modules / FR-08](../../context.md#missing-modules). Preserve every existing behavior (microcompact, autocompact, PTL retry, plan-mode gating, skill envelope, tool allowlist, cancellation) under the new orchestration model.

## Scope

In scope:
- Add `@langchain/langgraph` runtime dependency.
- Create `src/agent/graph.ts` exporting `buildAgentGraph(deps) → CompiledStateGraph`. Deps: `{provider, toolRegistry, skillListing, planMode, rag/ragEngine, budget, clock, logger, microcompact config, maxToolRoundTrips}`.
- Introduce a `GraphBuilder` class (or function) that binds per-thread values (`skill`, `allowedTools`, `focus`) at turn dispatch time and returns the compiled graph.
- Define the `AgentState` shape: `{messages, timestamps, focus, rag, pendingToolCalls, toolAllowlist, model, cancelled, errored, turnFlags}`.
- Define graph nodes: `prepareContext` (RAG + assemble + truncate + skill listing), `applyMicrocompact`, `callModel` (stream via provider), `handleToolCalls` (plan-mode gate → invoke → skill envelope → context modifier), `finalize` (append history, emit done).
- Wire conditional edges: `callModel → handleToolCalls` if tool_calls present, else `callModel → finalize`. `handleToolCalls → applyMicrocompact → callModel` (loop until `maxToolRoundTrips` reached or cancelled).
- Internally keep using `EventChannel` to push stream events out of graph nodes; `AgentRunner.drive()` becomes a thin wrapper that kicks off `graph.stream(initialState, {signal})` and forwards events.
- Feature-flag via a constant so the old imperative loop can be re-enabled for one release if regression is found.

Out of scope:
- Tool-confirmation interrupt (F05).
- Public `AgentRunner.send()` API change (F07).
- UI-visible stream contract normalization (F06).
- Persistent checkpointing (not required by SRS).
- Multi-agent graphs.

## Acceptance criteria

1. `src/agent/graph.ts` exists and exports a compiled graph factory. (FR-08)
2. `GraphBuilder` constructs a per-thread compiled graph using `{provider, tools, skill, RAG}` per [architecture.md §3.2](../../../../architecture/architecture.md#32-agent-layer). (FR-02)
3. `AgentRunner.drive()` dispatches through the graph; the current inline `for let roundTrip …` loop in [`src/agent/agentRunner.ts`](../../../../../src/agent/agentRunner.ts) lines ~335-441 is removed. (FR-01)
4. All existing tests under [`tests/unit/agentRunner.test.ts`](../../../../../tests/unit/agentRunner.test.ts), [`tests/unit/agentRunner.microcompact.test.ts`](../../../../../tests/unit/agentRunner.microcompact.test.ts), and [`tests/llm/agent.live.test.ts`](../../../../../tests/llm/agent.live.test.ts) pass unchanged or receive minimal renames only. (NFR-01, NFR-04)
5. Microcompact pass runs at the same boundary (before `callModel`). Autocompact / PTL retry hooks are reachable from graph nodes with no behavior delta. (NFR-04)
6. Plan-mode write-tool gating runs before tool invoke inside `handleToolCalls`. (NFR-04)
7. Skill envelope injection + `contextModifier` (tools/model override) operates inside `handleToolCalls` identically to current `drive()` behavior. (NFR-04)
8. Turn-level streaming throughput on a reference prompt stays ≥ 95% of baseline (measure token/sec and total turn latency). (NFR-03)
9. `package.json` `keywords` array keeps `"langgraph"`; this entry now reflects reality. (FR-10)

## Dependencies

- [F01 — zod-tool-schema](../zod-tool-schema/feature.md) — graph nodes type-check against zod ToolSpec.
- [F02 — tool-ctx-adapters](../tool-ctx-adapters/feature.md) — `handleToolCalls` builds `ToolCtx` from the factory.
- [../../context.md § Runtime orchestration](../../context.md#runtime-orchestration)
- [../../context.md § Missing modules](../../context.md#missing-modules)
- [../../features-index.md](../../features-index.md) row F04

## Implementation notes

- Architectural anchor — [architecture.md § 1 Architectural Principles](../../../../architecture/architecture.md#1-architectural-principles), [§ 2 Layer Diagram](../../../../architecture/architecture.md#2-layer-diagram), [§ 3.2 Agent Layer](../../../../architecture/architecture.md#32-agent-layer), [§ 5.3 Chat Turn with tool call](../../../../architecture/architecture.md#53-chat-turn-with-tool-call--confirmation).
- Concurrency rules — [architecture.md § 10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules).
- Coding style — [code-style.md](../../../../standards/code-style.md).
- Testing / incremental delivery — [best-practices.md](../../../../standards/best-practices.md).
- Tech-stack governance for new deps — [tech-stack.md](../../../../standards/tech-stack.md).

## Open questions

1. Which LangGraph TS API — graph (`StateGraph`) or functional? Default: graph API. Confirm against [tech-stack.md](../../../../standards/tech-stack.md) once picked.
2. Should autocompact live inside the graph (as a pre-node) or remain a preprocessing step outside the graph? Default: inside the graph as a conditional entry branch so it participates in cancellation.
3. Do we keep `EventChannel` as the UI-facing transport while graph streams internally, or replace with `graph.stream()` AsyncIterable directly? Default: keep EventChannel for this feature; F07 migrates the public boundary.
4. Per-thread graph cache vs per-turn rebuild — graphs are cheap to compile; default to per-turn rebuild unless profiling shows it matters.
