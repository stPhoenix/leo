# Compliance iteration 1 — F14 multistep-research-step

## Acceptance criteria
- AC1 (tool list): PASS — `researchStep.test.ts` "includes extract_note; excludes publish_artifact".
- AC2 (extract_note → rewrite stub): PASS — "extract_note → next iteration sees stub for consumed search_web result" inspects the third invokeTurn call and asserts the stub.
- AC3 (step-boundary drop): PASS — `dropRawToolMessagesAtStepBoundary` (F10) covered both there and in this slice.
- AC4 (per-step iteration budget recomputed at step start with rollover): PASS by F16 wiring — F14 accepts `perStepIterations` per call; F16 computes via `perStepBudget(remainingIterations, remainingSteps)`. Rollover is automatic because the cumulative `runState.iterations` carries forward.
- AC5 (per-step cap → step exits, notes intact): PASS — "per-step cap fires step-level error_limit, notes intact"; `runState.notes` unaffected by the iteration_limit.
- AC6 (cumulative cap → graph error): PASS by F16 — the graph monitors `runState.iterations` against `selectMaxIterations('multistep', config.budgets)` and surfaces `iteration_limit` when reached.
- AC7 (node_complete log per step exit, no text events from metadata log): PASS — emitted as `BridgeChunk` with kind `node_complete`; metadata never emits text.

## Scope coverage
- In scope "researchStep.ts": PASS.
- In scope "Tool list excluding publish_artifact, including extract_note": PASS.
- In scope "Bookkeeping consumedRefs": PASS.
- In scope "Apply F10 rewriteConsumedToolResults each iteration": PASS.
- In scope "Per-step cap exhaustion advance": PASS.

## Out-of-scope audit
- Out of scope "Synthesize": CLEAN — F15.
- Out of scope "Plan generation": CLEAN — F13.
- Out of scope "Top-level loop driving N steps": CLEAN — F16.

## QA aggregate
`qa-1.md` verdict PASS — 1803/1803, lint/typecheck/build green.

## Verdict: PASS
