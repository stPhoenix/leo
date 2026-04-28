# Compliance iteration 1 — F12 branch-simple

## Acceptance criteria
- AC1 (tool list excludes extract_note): PASS — `buildSimpleBranchTools (F12, AC1)` dual cases.
- AC2 (terminate on assistant message with no tool calls): PASS — `terminates on assistant message with no tool calls`.
- AC3 (iteration cap → error.code='iteration_limit'; partial flush still possible): PASS — `iteration cap fires error`. Partial-flush wiring is owned by F16; the helper exposes the error event so the graph can route to `flushPublishedArtifacts` before terminating.
- AC4 (counters tick per round-trip): PASS — `counters tick per round-trip` asserts `runState.iterations === 2` and tokens.
- AC5 (text events + tool start/end logs): PASS — `tool start/end events emitted around tool invocation`.
- AC6 (signal threading): PASS — `abort exits without further iterations`.

## Scope coverage
- In scope "buildSimpleBranchTools + runSimpleBranch": PASS.
- In scope "Tool list assembly excludes extract_note; filtered by enabled": PASS.
- In scope "createReactAgent equivalent inner loop": PASS (hand-rolled equivalent, see impl-1.md deviation).
- In scope "Stream via bridgeStream (F05)": PASS — `runSimpleBranch via bridge` test.
- In scope "Increments runState counters": PASS.
- In scope "Iteration cap from F04": PASS.
- In scope "Termination + cap-hit error": PASS.

## Out-of-scope audit
- Out of scope "Recursion guard assertion": CLEAN — no `delegate_external` ever reachable; F16 will assert at assembly time.
- Out of scope "Multistep nodes": CLEAN.
- Out of scope "Top-level graph wiring": CLEAN.

## QA aggregate
`qa-1.md` verdict PASS — 1784/1784, lint/typecheck/build green.

## Verdict: PASS
