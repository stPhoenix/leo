# Compliance iteration 1 — F11 router-classify

## Acceptance criteria
- AC1 (auto-mode invokes classifier; initialPlan clamped to planMaxSteps): PASS — `router.test.ts` "returns parsed structured output and ticks counters" + "initialPlan clamped to planMaxSteps".
- AC2 (classifier given only classify_task tool): PASS by construction — the classifier uses `model.withStructuredOutput(classifyTaskOutputSchema, { name: 'classify_task' })` which binds exactly that one tool. No tool list is passed; no built-in tools surface in the classifier prompt body.
- AC3 (inventory filtered by `enabled`): PASS — `buildToolInventory: AC3 disabled tools omitted`.
- AC4 (one retry → fallback `route: 'simple'` + one log warn): PASS — both schema-mismatch and thrown-error scenarios assert two attempts + one warn.
- AC5 (override modes skip classifier): PASS — both `'simple'` and `'deep'` cases verify `factory` not called and counters stay at 0.
- AC6 (counters incremented exactly once per LLM call; zero on override): PASS — auto happy-path asserts `iterations === 1`; override cases assert `iterations === 0`.
- AC7 (one node_complete log on completion; no text events): PASS by design — `classifyTask` only emits `kind: 'node_complete'` chunks and never `text`.

## Scope coverage
- In scope "router.ts buildToolInventory + classifyTask": PASS.
- In scope "schemas.ts classify_task subset": PASS — `tools/schemas.ts` (added in F06 slice).
- In scope "Routing-mode override": PASS.
- In scope "Emits log info node_complete": PASS — emitted via `BridgeChunk { kind: 'node_complete' }`.
- In scope "Unit tests": PASS — 8 cases.

## Out-of-scope audit
- Out of scope "Planner node": CLEAN — F13 owns it.
- Out of scope "Token budget enforcement": CLEAN — counters only ticked, no `over` gate (F16 wires).

## QA aggregate
`qa-1.md` verdict PASS — 1773/1773, lint/typecheck/build green.

## Verdict: PASS
