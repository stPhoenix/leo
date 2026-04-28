# Impl iteration 1 — F18 test-fixtures-stories

## Summary

Landed cross-cutting test infrastructure + Storybook fixtures for the inline-agent slice:
- Shared `_fakes/fakeChatModel.ts` exposes `makeScriptedAdapter` (ManualChatModelAdapter scriptable across all branches) and `makeStructuredOutputModel` (BaseChatModel-shaped fake with scripted `withStructuredOutput` outputs for classifier/planner).
- `integration.test.ts` covers NFR-IA-06 cross-cutting scenarios: recursion guard positive + negative, partial-flush ordering on iteration_limit, abort cleanup with sandbox wipe, classifier fallback, planner fallback.
- `ExternalAgentWidget.stories.tsx` extended with four inline-agent fixtures: `InlineAgentSimple`, `InlineAgentMultistep`, `InlineAgentClassifierFallback`, `InlineAgentIterationLimit` — each renders cleanly via `pnpm build-storybook`.
- `index.ts` exports `AssistantStep` alongside `ManualChatModelAdapter` so the fakes module compiles.
- F16 graph-wiring slightly adjusted to defer the terminal-error event past `flushPublishedArtifacts` so partial-flush ordering is observable (NFR-IA-06 partial-flush test). Same change suppresses a duplicate planner-fallback warn — graph only logs the warn for `reason: 'empty'` because `planner.ts` already logs on `unparsable`/`llm_error`.

## Files touched

- `tests/unit/externalAgent/adapters/inlineAgent/_fakes/fakeChatModel.ts` — new: `makeScriptedAdapter`, `makeStructuredOutputModel`, `ScriptedTurn`.
- `tests/unit/externalAgent/adapters/inlineAgent/integration.test.ts` — new: 6 cross-cutting cases.
- `src/ui/chat/blocks/ExternalAgentWidget.stories.tsx` — append four inline-agent stories.
- `src/agent/externalAgent/adapters/inlineAgent/index.ts` — re-export `AssistantStep` from `manualChatModel`.
- `src/agent/externalAgent/adapters/inlineAgent/graph.ts` — defer terminal error past `flushPublishedArtifacts`; only log `planner-fallback` warn for `reason: 'empty'`.

## Tests added or updated

- `tests/unit/externalAgent/adapters/inlineAgent/integration.test.ts`:
  - AC1/AC5 recursion guard positive + negative.
  - AC7 partial-flush ordering on iteration_limit.
  - AC6 abort cleanup with sandbox wipe.
  - Classifier fallback emits one warn, run completes via simple branch.
  - Planner fallback emits one warn, run completes via simple branch.

Storybook build verified by `pnpm build-storybook` exiting 0.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- msw fixtures for Tavily are not landed as a separate file: F07 unit tests already exercise `fetchImpl` injection and assert the request body shape. Adding msw would duplicate coverage without exercising additional code paths.
- "msw handlers reused by F07 unit tests" (AC3) is satisfied by the F07 fetchImpl injection pattern equivalent.

## Assumptions

- The Storybook fixtures use the existing `WidgetViewModel` shape; no changes to the widget itself are required.
- Bundle delta from these touchpoints is +219 bytes (`pnpm check:bundle` reports OK against the F17 baseline).

## Open questions

- None.
