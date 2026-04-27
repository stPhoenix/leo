# Compliance iteration 1 — F10 tool-extract-note

## Acceptance criteria
- AC1 (id increments, noteCount): PASS — `extractNote.test.ts` "id increments deterministically n1, n2, n3 with noteCount".
- AC2 (>2 KB summary → summary_too_large; loop continues): PASS — same file, dedicated case + retry with smaller summary.
- AC3 (stepIndex captured): PASS — "stepIndex captured from runState.currentStep".
- AC4 (selective rewrite preserves order): PASS — "rewrites only tool messages with consumed toolCallId" + "empty consumedRefs leaves all messages untouched".
- AC5 (step-boundary drop): PASS — "drops tool messages but keeps system/user/assistant".
- AC6 (relevance bounds): PASS — "relevance outside [0,1] rejected at Zod boundary".
- AC7 (extract_note absent from simple branch): deferred to F12 graph wiring; tests there will assert tool-list assembly.

## Scope coverage
- In scope "extractNote.ts factory": PASS — `tools/extractNote.ts`.
- In scope "messageRewriter.ts pure helpers": PASS — `multistep/messageRewriter.ts`.
- In scope "ID assignment + summary cap": PASS.
- In scope "Step-boundary drop": PASS.
- In scope "Unit tests": PASS — 11 cases.

## Out-of-scope audit
- Out of scope "Orchestration of tool_call_id → noteId": CLEAN — F14 owns it.
- Out of scope "extract_note in simple branch": CLEAN — no tool-list change here.

## QA aggregate
`qa-1.md` verdict PASS — 1763/1763, lint/typecheck/build green.

## Verdict: PASS
