# QA iteration 1 — F05 chat-message-list-markdown

## Typecheck
Command: `pnpm typecheck`
Exit: 0
Verdict: PASS

## Lint
Command: `pnpm lint`
Exit: 0
Verdict: PASS

## Tests
Command: `pnpm test`
Exit: 0
Verdict: PASS

```
Test Files  18 passed (18)
     Tests  124 passed (124)
```

New suites this iteration: `tests/unit/messageStore.test.ts` (5), `tests/unit/scrollAnchoring.test.ts` (7), `tests/unit/codeBlockEnhancer.test.ts` (5 happy-dom), `tests/dom/messageList.test.tsx` (7 happy-dom + RTL). The F04 `tests/dom/chatRoot.test.tsx` suite is updated to inject the new ChatRoot props and continues to pass (8 tests).

## Build
Command: `pnpm build`
Exit: 0
Verdict: PASS

Production bundle `main.js` ≈ 181 KB — well under the 1.5 MB tech-stack budget.

## Verdict: PASS
