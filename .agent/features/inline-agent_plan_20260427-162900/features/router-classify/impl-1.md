# Impl iteration 1 — F11 router-classify

## Summary

Landed `router.ts` with `buildToolInventory` (post-`enabled` filter) and `classifyTask` node: routing-mode override skips the classifier (no LLM call); `'auto'` mode calls `model.withStructuredOutput(classifyTaskOutputSchema)` once with a fallback retry at `temperature: 0`; both attempts on failure → fallback to `route: 'simple'` with one `log warn` and a `node_complete` log event. Counters tick once per LLM call, zero on override.

## Files touched

- `src/agent/externalAgent/adapters/inlineAgent/router.ts` — new: `buildToolInventory`, `classifyTask`, `ClassifyTaskNodeResult`, classifier system + user prompt builders.

## Tests added or updated

- `tests/unit/externalAgent/adapters/inlineAgent/router.test.ts` — 8 cases:
  - `buildToolInventory`: AC3 disabled tools omitted; full-enabled inventory excludes multistep-only `extract_note`.
  - Auto-mode happy path: structured-output parsed; AC1 plan clamp; counters incremented; node_complete event.
  - Override modes: AC5 simple + deep skip classifier (factory never called).
  - Retry+fallback: schema mismatch and thrown error both fall back to simple, log warn once.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- Open-question resolutions: retry uses `temperature: 0` per the open question; fallback `reasoning` set to `'classifier_fallback'` (not propagated downstream — log-only per AC).
- The `buildToolInventory` always includes `publish_artifact` because publication is the cross-branch terminal mechanism — disabling fileOps does not turn off artifact nomination.

## Assumptions

- `BaseChatModel.withStructuredOutput(schema, { name })` is the uniform contract (LangChain ≥ 0.2 covers OpenAI, Anthropic, Ollama). The wrapper rejects models that don't expose it with `'chat model does not support withStructuredOutput'`, which falls back to `route: 'simple'` after retry.

## Open questions

- F16 will pass real LangChain `BaseChatModel` instances; the F18 fixture phase will exercise the classifier integration end-to-end with a fake ChatModel.
