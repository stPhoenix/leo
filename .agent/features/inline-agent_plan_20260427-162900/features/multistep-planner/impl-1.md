# Impl iteration 1 — F13 multistep-planner

## Summary

Landed `multistep/planner.ts` with `planSteps`: when classifier supplied an `initialPlan`, the planner clamps to `[1, planMaxSteps]` and skips the LLM (zero counter ticks); otherwise it issues a `withStructuredOutput(plannerOutputSchema)` call (single retry at temperature 0 on schema-mismatch / throw). Empty/unparsable response → `{ok:false, reason}` with one `log warn`. Always emits one `node_complete` BridgeChunk.

## Files touched

- `src/agent/externalAgent/adapters/inlineAgent/multistep/planner.ts` — new: `planSteps`, `PlannerResult`, prompt builders, plan-clamp helper.

## Tests added or updated

- `tests/unit/externalAgent/adapters/inlineAgent/planner.test.ts` — 8 cases:
  - AC1 initialPlan path skips LLM and clamps.
  - AC2 LLM path with clamp at planMaxSteps.
  - AC3 empty plan and double-throw fall back with planner-fallback warn.
  - AC4 clamp at config + hard-max via configSchema rejection.
  - AC5 only node_complete chunks (no `text`).
  - AC6 counters not ticked when using initialPlan.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- None.

## Assumptions

- Planner uses the same provider/model as the run (per SRS open-question lean).
- Plan-step strings unbounded length (defer cap; LLM output already constrained by prompt).

## Open questions

- F18 will run the planner against an msw-mocked provider.
