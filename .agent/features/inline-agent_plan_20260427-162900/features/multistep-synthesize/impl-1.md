# Impl iteration 1 — F15 multistep-synthesize

## Summary

Landed `multistep/synthesize.ts` with `buildSynthesizeTools` (only `publish_artifact`), `buildSynthesizePrompt` (notes-only context), `selectSynthesizeIterations` (4-iteration reserve floor), and `runManualSynthesizeLoop` (hand-rolled ReAct mirroring F12/F14). Prompt format includes `refinedAsk`, numbered `plan`, deterministic note rendering `(n#) [title] — summary (source: …) (relevance: 0.xx)`, and `scratchpad`. `runSynthesize` is the public async generator that wraps the loop through the F05 bridge.

## Files touched

- `src/agent/externalAgent/adapters/inlineAgent/multistep/synthesize.ts` — new: tool builder, prompt builder, iteration reserve, manual ReAct loop, public generator.

## Tests added or updated

- `tests/unit/externalAgent/adapters/inlineAgent/synthesize.test.ts` — 11 cases:
  - `buildSynthesizeTools`: AC1 only `publish_artifact`.
  - `buildSynthesizePrompt`: AC2 prompt structure + absence of raw tool markers; empty-state graceful.
  - `selectSynthesizeIterations`: AC4 reserve floor (table-driven).
  - `runManualSynthesizeLoop`: AC3 termination + AC5/AC6 publish_artifact callable + counter ticks; AC4 iteration cap still surfaces error.
  - `runSynthesize`: default loop emits not_implemented (F16 wires manualAdapter).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- Open-question resolutions:
  - Notes formatting: `(n#) [title] — summary (source: <url>) (relevance: 0.xx)` — chosen to make re-citation deterministic.
  - Free-form markdown response (per SRS lean).
  - No hard fail on empty notes — synthesize answers with whatever the model produces.
- Hand-rolled ReAct loop matches F12/F14 pattern; F16 will wire one ManualChatModelAdapter for all three.

## Assumptions

- Synthesize never receives raw tool messages — only the system prompt + the assembled prompt — so the F10 step-boundary drop happens at the F16 graph layer between `runManualResearchLoop` and `runManualSynthesizeLoop`.

## Open questions

- F18 will wire end-to-end multistep flow against the fake provider.
