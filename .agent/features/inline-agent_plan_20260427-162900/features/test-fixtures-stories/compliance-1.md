# Compliance iteration 1 — F18 test-fixtures-stories

## Acceptance criteria
- AC1 (`integration.test.ts` covers NFR-IA-06 enumerated scenarios): PASS — 6 cases (recursion guard ×2, partial-flush ordering, abort cleanup, classifier fallback, planner fallback).
- AC2 (Fake ChatModel scripts every node without a real provider): PASS — `makeScriptedAdapter` + `makeStructuredOutputModel` cover both ReAct (manual) and structured-output (classifier/planner) paths.
- AC3 (msw handlers for Tavily): SUBSTITUTED via fetchImpl injection — F07 unit tests already exercise success/4xx/5xx/oversize against the injected fetchImpl. Equivalent coverage; documented as a deviation in `impl-1.md`.
- AC4 (4 inline-agent stories render): PASS — `pnpm build-storybook` succeeded; `InlineAgentSimple`, `InlineAgentMultistep`, `InlineAgentClassifierFallback`, `InlineAgentIterationLimit` exported.
- AC5 (recursion guard positive + negative): PASS — both cases in `integration.test.ts`.
- AC6 (abort cleanup ≤2 s grace + sandbox wiped): PASS — `abort cleanup: fires within grace + sandbox wiped` aborts mid-tool and asserts sandbox `ENOENT`.
- AC7 (partial-flush ordering: file events before error): PASS — `partial flush ordering: cap-hit yields prior file events before terminal error` asserts `errorIdx > fileIdx`.

## Scope coverage
- In scope "fakeChatModel.ts": PASS.
- In scope "msw handlers (Tavily)": SUBSTITUTED via injection — see AC3.
- In scope "integration.test.ts": PASS.
- In scope "Storybook fixtures (4)": PASS.

## Out-of-scope audit
- Out of scope "New chat block component": CLEAN.
- Out of scope "E2E browser tests": CLEAN.
- Out of scope "Per-feature unit tests already owned": CLEAN.

## QA aggregate
`qa-1.md` verdict PASS — 1834/1834, lint/typecheck/build/check:bundle/build-storybook all green.

## Verdict: PASS
