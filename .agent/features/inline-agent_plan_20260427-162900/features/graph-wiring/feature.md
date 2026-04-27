# F16 — Top-level StateGraph + recursion guard + cancellation orchestration

## Purpose

Land `graph.ts` — the top-level hand-rolled `StateGraph` that wires `classify_task` → conditional-edge → simple OR planner→loop(`researchStep`)→synthesize → `publishArtifacts` → `done`. Owns:
- composed `AbortSignal` (host signal + wallClock timer) threaded into every node and tool;
- recursion-guard assertion that no node's tool list contains `delegate_external` or any other adapter-driving tool;
- final `finally` block that runs `sandbox.cleanup()` regardless of done/error/abort/throw.

Covers FR-IA-49, FR-IA-50, FR-IA-51, plus the orchestration scaffolding referenced in FR-IA-32..40.

## Scope

In scope:
- `src/agent/externalAgent/adapters/inlineAgent/graph.ts` exporting `async *runInlineAgentGraph(deps, input): AsyncIterable<ExternalEvent>`:
  - `deps` = `{ providerFactory, logger }`; `input` = `{ refinedAsk, systemPrompt, signal, timeoutMs, config, runId }`.
  - Materialize `Sandbox` (F03) → `init()`.
  - Materialize `runState` (F04) with `routingMode` from config.
  - Compose `AbortSignal` via F04 `composeAbortSignal(host, wallClock)`.
  - Run classifier (F11) → set `runState.route` and `runState.plan` (when `initialPlan` present).
  - Conditional-edge:
    - `route === 'simple'` → run F12; collect events; run flush (F09).
    - `route === 'multistep'` → run F13 (planner) — fall-back to simple branch on planner empty (`log warn`, set `route = 'simple'`, jump to simple); else loop F14 over `plan`; finally run F15 (synthesize); collect events; run flush.
  - Recursion-guard assertion at graph startup: `assertNoExternalDelegate(toolListsForAllBranches)` throws → adapter emits `{ type: 'error', error: { code: 'recursion_guard_violation' } }` and terminates (this is a code-bug check, never expected to fire in production).
  - Adapter `start()` (F01) replaces stub iteration with `yield* runInlineAgentGraph(...)`.
  - All paths thread `signal` into every `ChatModel.stream`, `tool.invoke`, `fetch`.
  - On abort: in-flight tools have ≤1 s rejection budget; adapter awaits 2 s grace then forces termination; `sandbox.cleanup()` always runs.
  - `try { ... } finally { sandbox.cleanup(); cancelWallClock(); }` — cleanup never throws past the iterable.

Out of scope:
- Tests of cross-cutting scenarios — F18.
- Bundle headroom guard — F17.
- New UI — none (existing widget consumes events unchanged).

## Acceptance criteria

1. `signal` is threaded into every `ChatModel.stream` call and every `tool.invoke` across classifier, planner, research-step (each step), synthesize, and simple branch ([context.md#fr-ia-49](../../context.md#functional-requirements)).
2. On host abort: in-flight tool rejections within ≤1 s; adapter awaits 2 s grace then forces termination; `sandbox.cleanup()` runs in `finally` ([context.md#fr-ia-50](../../context.md#functional-requirements)).
3. `assertNoExternalDelegate(toolList)` panics if any branch's tool list contains `delegate_external` or any other adapter-driving tool name; verified by negative unit test ([context.md#fr-ia-51](../../context.md#functional-requirements)).
4. `routingMode === 'simple'` and `'deep'` skip classifier; `'auto'` invokes classifier and routes accordingly.
5. Multistep planner empty/unparsable → fall-back to simple branch with `log warn` (per [F13](../multistep-planner/feature.md)).
6. Cumulative `iteration_limit` / `token_limit` / `timeout` (wallClock) → emit `{ type: 'error', error: { code, message } }`, still flush prior nominations, then terminate.
7. `sandbox.cleanup()` runs on done, error, abort, unexpected throw — verified by parameterized test.
8. Adapter never throws synchronously out of `start()` — verified by injecting failures into each node and asserting iterable termination ([context.md#fr-ia-48](../../context.md#functional-requirements)).

## Dependencies

- [F01](../adapter-scaffold/feature.md), [F03](../sandbox-primitives/feature.md), [F04](../run-state-budgets/feature.md), [F05](../event-bridge/feature.md), [F09](../tool-publish-artifact/feature.md), [F11](../router-classify/feature.md), [F12](../branch-simple/feature.md), [F13](../multistep-planner/feature.md), [F14](../multistep-research-step/feature.md), [F15](../multistep-synthesize/feature.md).
- [context.md#fr-ia-49](../../context.md#functional-requirements)..FR-IA-51, [context.md#fr-ia-48](../../context.md#functional-requirements).

## Implementation notes

- LangGraph `StateGraph` patterns: [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) §"LangGraph / Agent Layer".
- Async / abort / finally: [`.agent/standards/code-style.md`](../../../../.agent/standards/code-style.md) §"Async & Concurrency".
- Tech-stack note on hybrid graph rationale: [context.md#open-questions](../../context.md#open-questions) (OD-IA-1 hybrid: hand-rolled top-level + prebuilt ReAct inner).
- Best-practices: structured logs at every checkpoint ([`.agent/standards/best-practices.md`](../../../../.agent/standards/best-practices.md) §"Operational Excellence").

## Open questions

- Should the recursion guard assertion run at adapter construction (one-shot, in dev only) or per `start()` (defensive against config mutation)? Lean: per `start()` as a cheap safety net.
- Wall-clock timer racing with the host signal — confirm both signals fire deterministically when composed (F04 helper). Add a unit test where wallClock fires before host signal and vice versa.
- Recovery semantics on planner-fallback to simple — does the simple branch reuse the iteration budget already spent on classifier? Yes, `runState.iterations` is cumulative.
