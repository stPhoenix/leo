# Impl iteration 1 — F08 canvas-refine

## Summary
Added `src/agent/canvas/refine.ts` exporting `createCanvasRefine({provider,model,…}) → CanvasRefine` with `step({originalAsk,history,targetPath?,tombstoneSummary?,questionCount,signal,traceConfig?}) → 'plan'|'question'|'error'`. Two registered tools: `ask_clarifying_question`, `emit_run_plan`. Stream-event collector handles OpenAI-style `tool_call` events and Anthropic-style `block_start[tool_use] → input_json_delta → block_stop`. Single retry on Zod RunPlan parse failure with parser issues injected as a user message; second failure → `refine_invalid_plan`. Caller-tracked `questionCount`; `>= maxClarifications` short-circuits to `refine_unresolved`. `targetPath` and `tombstoneSummary` are routed into the user context message. Added `src/agent/canvas/refinePrompt.ts` exporting `getCanvasRefineSystemPrompt()`.

## Files touched
- `src/agent/canvas/refine.ts` — refine sub-agent
- `src/agent/canvas/refinePrompt.ts` — frozen system prompt
- `tests/unit/canvas/refine.test.ts` — 11 unit tests
- `tests/unit/canvas/_refineHelpers.ts` — re-export helper for tests

## Tests added or updated
- `tests/unit/canvas/refine.test.ts` covers AC1 (plan emit), AC2 (clarify emit), AC3 (single retry then fail), AC4 (freeform layoutHint rejected), AC5 (missing outputPath rejected), AC6 (only two tools registered), AC7 (tombstone summary in context), plus targetPath authoritative + clarification-cap.

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
- F08's `### In scope` declares the iteration cap is enforced inside refine; `### Out of scope` says "Driver-level loop until plan or cap — F16 owns the loop". Resolved by making `step()` accept a caller-supplied `questionCount` and short-circuit at the cap; F16 increments and re-calls. This keeps `step()` stateless (testable) while the cap enforcement is one assertion at the entry.
- The `emit_run_plan` JSONSchema is permissive (only `plan: object` required) — Zod is the strict gate post-call. Stricter per-property JSONSchema would duplicate the Zod schema and risk drift; weaker LLMs (Qwen3 30B) drop optional fields under strict JSONSchema.

## Assumptions
- Stream-event shape mirrors `src/agent/externalAgent/refineSubAgent.ts` — Leo's `ProviderManager` normalises both OpenAI-style `tool_call` events and Anthropic-style `block_*` events; the collector handles both.
- "Plan" payload may be wrapped (`{ plan: {...} }`) or flat (LLM emits the plan directly under tool args). Both shapes are accepted; `coerceRunPlan` injects `targetPath` if supplied authoritative.

## Open questions
- Bench at Phase 6 whether `tool_choice` enforcement should be relaxed for Qwen3 30B (per feature.md open question). Not enforced in v1.
