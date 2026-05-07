# Compliance iteration 1 — F08 canvas-refine

## Acceptance criteria
- AC1: PASS — `tests/unit/canvas/refine.test.ts` "returns plan on valid emit_run_plan".
- AC2: PASS — "returns question on ask_clarifying_question".
- AC3: PASS — "retries once on Zod parse failure" + "returns refine_invalid_plan after two parse failures".
- AC4: PASS — "rejects freeform layoutHint".
- AC5: PASS — "rejects missing outputPath".
- AC6: PASS — "only registers ask_clarifying_question and emit_run_plan as tools".
- AC7: PASS — "routes tombstone summary into the user context message".

## Scope coverage
- In scope "`createCanvasRefine` + `step({…})`": PASS — `src/agent/canvas/refine.ts:88-152`.
- In scope "`getCanvasRefineSystemPrompt()`": PASS — `src/agent/canvas/refinePrompt.ts:30`.
- In scope "Zod schemas (RunPlan etc.)": PASS — already in `src/agent/canvas/schemas.ts` (F07); F08 imports `RunPlan`.
- In scope "Single retry on parse failure": PASS — `src/agent/canvas/refine.ts:127-150`.
- In scope "Iteration counter cap → refine_unresolved": PASS — `src/agent/canvas/refine.ts:99-101`.
- In scope "Optional traceConfig plumbed for Langfuse export": PASS — passed through `req.trace` at `src/agent/canvas/refine.ts:118`.

## Out-of-scope audit
- Out of scope "Driver-level loop": CLEAN — `step()` is single-shot.
- Out of scope "Widget-side clarification UX": CLEAN — F17 owns.
- Out of scope "Tombstone construction": CLEAN — F14 owns; refine merely consumes the summary string.

## QA aggregate
Verdict: PASS — typecheck/lint/tests/build all PASS.

## Integration notes
F08 has no wiring bullet in `### In scope`. Module will be imported by F16 (subgraph driver). Not yet referenced from `src/main.ts`. Confirmed intentional.

## Verdict: PASS
