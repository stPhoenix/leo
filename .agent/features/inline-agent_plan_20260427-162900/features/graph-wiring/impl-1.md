# Impl iteration 1 — F16 graph-wiring

## Summary

Landed `graph.ts` with `runInlineAgentGraph(deps, input)` — the top-level orchestrator wiring sandbox lifecycle, composed AbortSignal, recursion-guard assertion, classifier→branch dispatch, planner+research-loop+synthesize for multistep, simple-branch run, and final `flushPublishedArtifacts` + `done` emission. All paths run inside `try/finally` so `sandbox.cleanup()` and the wall-clock timer cancel happen on done/error/abort/throw.

`InlineAgentAdapter.start()` (F01 stub) replaced with a thin pass-through that does config parse + provider whitelist gate, then delegates to `runInlineAgentGraph`. Lazy `import('./graph')` keeps F01-only paths (config/provider rejection) free from the graph module's transitive cost.

Unified the per-branch ReAct loop interface into a shared `manualChatModel.ts` (`ManualChatModelAdapter` + `AssistantStep`) so the F12 simple branch, F14 research step, and F15 synthesize all consume the same adapter shape. Test-friendly: F18 (or production) wires one BaseChatModel → `ManualChatModelAdapter` mapping.

## Files touched

- `src/agent/externalAgent/adapters/inlineAgent/graph.ts` — new: `runInlineAgentGraph`, `assertNoExternalDelegate`, `FORBIDDEN_TOOL_NAMES`.
- `src/agent/externalAgent/adapters/inlineAgent/manualChatModel.ts` — new: shared `ManualChatModelAdapter` + `AssistantStep`.
- `src/agent/externalAgent/adapters/inlineAgent/index.ts` — wire `start()` to `runInlineAgentGraph`; expose new constructor deps `chatModelAdapter` + `resolveSearchWebApiKey`; re-export `ManualChatModelAdapter`.
- `src/agent/externalAgent/adapters/inlineAgent/branches/simpleBranch.ts` — switch local `ManualChatModel` interface for the shared adapter (RewriteMessage shape).
- `src/agent/externalAgent/adapters/inlineAgent/multistep/researchStep.ts` — drop local adapter interface, import shared.
- `src/agent/externalAgent/adapters/inlineAgent/multistep/synthesize.ts` — drop local adapter interface, import shared.

## Tests added or updated

- `tests/unit/externalAgent/adapters/inlineAgent/graph.test.ts` — 8 cases:
  - `assertNoExternalDelegate`: positive + negative + canonical export.
  - `runInlineAgentGraph`: invalid config; full simple-route happy path with sandbox cleanup; sandbox cleanup on error path; never re-throws; flush emits `file` events after simple branch.
- `tests/.../scaffold.test.ts`, `sandbox.test.ts`, `startConfigGate.test.ts`: legacy "not_implemented stub" assertions updated for the new behavior — adapter now surfaces `invalid_provider` when the test's stub providerFactory throws (sandbox cleanup still verified).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- Graph is an async generator that yields events directly rather than a LangGraph `StateGraph`. The conditional-edge-then-branch logic is plain control flow; LangGraph's StateGraph adds no value over a hand-rolled iterator at this granularity (and would inflate the bundle, NFR-IA-03). Inner ReAct loops (F12/F14/F15) remain hand-rolled — same OD-IA-1-style hybrid, but with hand-rolled inner loops too because the inner loops require fine-grained per-iteration message rewriting (F10/FR-IA-39).
- Recursion-guard assertion runs per `start()` (cheap safety net per the open question lean).
- The `runInlineAgentGraph` `try/finally` covers `sandbox.cleanup()` + `composed.cancel()` so the iteration always frees both resources, regardless of caller behaviour.

## Assumptions

- F18 will provide the `chatModelAdapter` BaseChatModel→ManualChatModelAdapter binding via the test fakes; production wiring lands in main.ts when the inline-agent provider factory is implemented.
- The `flushPublishedArtifacts` runs *unconditionally after both branches*, including on iteration_limit/token_limit errors — matches FR-IA-36 partial-flush rule. Hard graph errors are emitted before flush.

## Open questions

- F18 will exercise end-to-end multistep + abort + token-limit scenarios.
