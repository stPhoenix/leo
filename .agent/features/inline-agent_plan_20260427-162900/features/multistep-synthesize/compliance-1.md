# Compliance iteration 1 — F15 multistep-synthesize

## Acceptance criteria
- AC1 (only publish_artifact): PASS — `synthesize.test.ts` "only publish_artifact".
- AC2 (notes-only prompt; no raw tool messages): PASS — "receives only refinedAsk + plan + notes + scratchpad" asserts presence + absence of raw tool markers.
- AC3 (terminate on assistant-no-tool-calls; routes to publishArtifacts→done): PASS — "terminates on assistant message without tool calls; emits done"; F16 routes `done` event to `flushPublishedArtifacts`.
- AC4 (4-iteration reserve floor): PASS — `selectSynthesizeIterations` table-driven over 0/1/4/10.
- AC5 (counters tick per round-trip): PASS — `publish_artifact tool callable; round-trip ticks counters` asserts iterations + tokens.
- AC6 (text deltas + tool logs per F05): PASS — events sequence in test asserts `text`, `tool_start`, `tool_end`, `node_complete`, `done`.
- AC7 (signal threading): inherited from F12/F14 pattern — same `signal` argument plumbed into adapter `invokeTurn` and tool `invoke`.

## Scope coverage
- In scope "synthesize.ts": PASS.
- In scope "Tool list = [publish_artifact]": PASS.
- In scope "Notes-only prompt": PASS.
- In scope "synthesizeReserve = 4": PASS.
- In scope "Stream + counters + termination": PASS.

## Out-of-scope audit
- Out of scope "Per-step research": CLEAN.
- Out of scope "Recursion guard assertion": CLEAN — F16.
- Out of scope "Top-level graph wiring": CLEAN — F16.

## QA aggregate
`qa-1.md` verdict PASS — 1816/1816, lint/typecheck/build green.

## Verdict: PASS
