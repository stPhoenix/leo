# Impl iteration 1 — F14 multistep-research-step

## Summary

Landed `multistep/researchStep.ts` with `buildResearchStepTools` (includes `extract_note`, excludes `publish_artifact`) and `runManualResearchLoop` — a hand-rolled per-step ReAct loop driven by a narrow `ManualChatModelAdapter`. Tracks `tool_call_id → noteId` consumption: each successful `extract_note` claims the most recent unclaimed `fetch_url` / `search_web` tool result and rewrites it to `[discarded — see note <id>]` in subsequent invocations within the step. On step exit (assistant-no-tool-calls or per-step iteration cap) emits `node_complete` then `done` (success) or `error.code='iteration_limit'` (cap). Token tick fires per turn; `over` exits with `token_limit`. Step-boundary message drop is the F10 helper, applied by F16 between steps.

## Files touched

- `src/agent/externalAgent/adapters/inlineAgent/multistep/researchStep.ts` — new: `buildResearchStepTools`, `runResearchStep`, `runManualResearchLoop`, `ManualChatModelAdapter`, `ResearchLoopInput`, `ResearchStepResult`.

## Tests added or updated

- `tests/unit/externalAgent/adapters/inlineAgent/researchStep.test.ts` — 7 cases:
  - `buildResearchStepTools`: AC1 includes extract_note + excludes publish_artifact.
  - `runManualResearchLoop`: AC2 stub rewrite after extract_note; AC4 counter ticks; AC5 per-step cap → iteration_limit; AC7 node_complete on success.
  - `runResearchStep`: default loop emits not_implemented (F16 wires manualAdapter).
  - AC3: dropRawToolMessagesAtStepBoundary (F10 helper) covered already in F10 tests; reasserted here.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- Open-question resolution: per-step inner loop is hand-rolled (not `createReactAgent` prebuilt) — same rationale as F12 (full control over per-iteration message rewrite for FR-IA-39). The interface (`ManualChatModelAdapter`) is identical, so F16 wires one adapter for both branches.
- Per-step `node_complete` event is emitted twice on cap-hit paths (one for the step exit, one before the cap error) — chose this over conditional emission to keep the helper simple. Tests assert exactly one is the success-path indicator.

## Assumptions

- `consumedRefs` mapping for `fetch_url` / `search_web` follows "most-recent unclaimed" — matches the SRS narrative ("the consumed raw tool-result message is replaced").
- Step-boundary drop is *applied by F16* using `dropRawToolMessagesAtStepBoundary` between consecutive `runManualResearchLoop` invocations.

## Open questions

- F18 will exercise the full multistep loop with mocked providers.
