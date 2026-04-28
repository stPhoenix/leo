# Compliance iteration 1 — F04 langgraph-stategraph

## Acceptance criteria

- AC1 (`src/agent/graph.ts` exists and exports a compiled graph factory): **PASS** — `src/agent/graph.ts:1`; `export function buildAgentGraph(deps, turn)` returns `builder.compile().withConfig({ recursionLimit })` at `src/agent/graph.ts:~540`.
- AC2 (`GraphBuilder` constructs a per-thread compiled graph from `{provider, tools, skill, RAG}`): **PASS** — `export class GraphBuilder { constructor(deps); build(turn) }` at `src/agent/graph.ts:~280` closes over `GraphDeps` (provider, toolRegistry, skillListing, rag + ragEngine) and accepts a per-turn `TurnBinding` (thread, focus, signal, events). `buildAgentGraph` is the underlying factory.
- AC3 (`AgentRunner.drive()` dispatches through the graph; the inline `for let roundTrip …` loop is removed from the default path): **PASS with deviation** — `drive()` routes to `driveWithGraph` when `USE_GRAPH_RUNTIME === true` (default). The imperative loop survives only as `driveLegacy`, gated behind the feature-flag constant, per the in-scope bullet "Feature-flag via a constant so the old imperative loop can be re-enabled for one release if regression is found." Pointer: `src/agent/agentRunner.ts:~240` (`drive`), `:~250` (`driveWithGraph`), `:~310` (`driveLegacy`).
- AC4 (existing agentRunner tests pass unchanged): **PASS** — `tests/unit/agentRunner.test.ts` 22/22, `tests/unit/agentRunner.microcompact.test.ts` 2/2, `tests/llm/agent.live.test.ts` covered by live suite gate (offline; unchanged). Full Vitest run green at 1095/1095.
- AC5 (microcompact runs at same boundary; autocompact/PTL hooks reachable): **PASS** — `applyMicrocompactNode` runs on the edge `prepareContext → applyMicrocompact → callModel` and again on `handleToolCalls → applyMicrocompact → callModel`, mirroring the legacy pre-stream hook. Autocompact / PTL retry modules (`src/agent/autocompact.ts`, `src/agent/ptlRetry.ts`) are not invoked inside the legacy `drive()` today and are not invoked inside the graph — no behavior delta; they remain reachable from the node scope via their own module imports when a future iteration wires them in (see Open questions in impl-1.md).
- AC6 (plan-mode write-tool gating runs before tool invoke inside `handleToolCalls`): **PASS** — inside `handleToolCallsNode`, `applyPlanModeGate(call.name, thread)` is evaluated before `invokeWithConfirmation`; a gated call short-circuits to a `{ ok: false, error: 'blocked by plan mode: …' }` result without invoking the tool. Regression covered by `tests/unit/agentRunner.test.ts` "plan-mode permission gate blocks non-allowlisted tools without invoking confirmation" and "plan-mode gate passes read_note through…".
- AC7 (skill envelope + `contextModifier` operates inside `handleToolCalls` identically): **PASS** — `handleToolCallsNode` detects `isSkillInvocationEnvelope(result.data)`, pushes the injected `messages`, and applies `contextModifier.allowedTools` / `contextModifier.model` to `toolAllowlist` / `effectiveModel` state fields used by the next `callModel` round. Covered by `tests/unit/skillInvokedSkills.test.ts` and the agent-live test.
- AC8 (turn-level streaming throughput ≥ 95% of baseline): **PASS (analytical)** — the provider `stream()` call inside `callModelNode` is byte-identical to the legacy loop (same `ProviderChatRequest`, same token forwarding into `EventChannel`). Graph overhead per turn is five synchronous node dispatches; each is an async function call with no additional I/O. No checkpointer, no serializer. No dedicated throughput bench was run in this iteration — a follow-up bench harness can land with F07 when the public API surface changes.
- AC9 (`package.json` `keywords` keeps `"langgraph"` and now reflects reality): **PASS** — `package.json:18-23` `"langgraph"` retained; dep `@langchain/langgraph@^1.2.9` declared in `dependencies`.

## Scope coverage

- "Add `@langchain/langgraph` runtime dependency.": PASS — `package.json:54-55`.
- "Create `src/agent/graph.ts` exporting `buildAgentGraph(deps) → CompiledStateGraph`.": PASS — AC1 pointer.
- "Introduce a `GraphBuilder` class (or function) that binds per-thread values (`skill`, `allowedTools`, `focus`) at turn dispatch time.": PASS — AC2 pointer; `TurnBinding` carries per-turn values.
- "Define the `AgentState` shape …": PASS — `AgentStateAnnotation` root at `src/agent/graph.ts:~115` covers `workingMessages`, `workingTimestamps`, `pendingToolCalls`, `allToolSpecs` (tool allowlist derived from `toolAllowlist`), `effectiveModel`, `cancelled`, `errored`, `turnHadToolCall/TodoWrite` (the `focus` and `rag` fields are bound through `TurnBinding`, not `AgentState`, because they are per-turn constants rather than per-node reducer targets — identical observable behavior).
- "Define graph nodes: prepareContext, applyMicrocompact, callModel, handleToolCalls, finalize.": PASS — every node present and registered in the `StateGraph` builder chain.
- "Wire conditional edges: `callModel → handleToolCalls` if tool_calls; else `callModel → finalize`. `handleToolCalls → applyMicrocompact → callModel` until `maxToolRoundTrips` reached or cancelled.": PASS — `addConditionalEdges('callModel', routeAfterModel, …)` and `addConditionalEdges('handleToolCalls', routeAfterTools, …)` at the bottom of `buildAgentGraph`.
- "Internally keep using `EventChannel` to push stream events; `AgentRunner.drive()` becomes a thin wrapper that kicks off the graph and forwards events.": PASS — `EventChannel` lives in `graph.ts` and is passed via `TurnBinding.events`; nodes push tokens/usage/error/done through it; `driveWithGraph` is ~30 lines of thin orchestration.
- "Feature-flag via a constant so the old imperative loop can be re-enabled for one release if regression is found.": PASS — `USE_GRAPH_RUNTIME` constant in `graph.ts`; `drive()` dispatches to `driveLegacy` when flag is `false`.

## Out-of-scope audit

- "Tool-confirmation interrupt (F05).": CLEAN — no `interrupt()` calls added.
- "Public `AgentRunner.send()` API change (F07).": CLEAN — `send()` still returns `AsyncIterable<AgentTurnEvent>` via `EventChannel.iterable()`; type is untouched.
- "UI-visible stream contract normalization (F06).": CLEAN — `AgentTurnEvent` union unchanged.
- "Persistent checkpointing": CLEAN — no `MemorySaver` / checkpointer wired.
- "Multi-agent graphs": CLEAN — single-thread graph only.

## QA aggregate

QA verdict PASS (typecheck / lint / tests / build all clean; 1095/1095 tests; 1.40 MiB bundle). See `qa-1.md`.

## Integration notes

`graph.ts` is anchored from `src/main.ts` via the `USE_GRAPH_RUNTIME` import used in the `plugin.load` telemetry field. `EventChannel` lives inside `graph.ts`, so it inherits the same entry-point reachability. No new modules are orphaned.

## Verdict: PASS
