# QA iteration 1 — F02 tool-ctx-adapters

## Typecheck
Command: `npm run typecheck`
Exit: 0
Verdict: PASS

## Lint
Command: `npm run lint`
Exit: 0
Verdict: PASS

## Tests
Command: `npm test`
Exit: 0
Test Files: 118 passed (118)
Tests: 1095 passed (1095) — +4 net-new (`toolCtxGuard.test.ts`).
Verdict: PASS

## Build
Command: `npm run build`
Exit: 0
Output: `main.js` = 757 680 B raw / 197 508 B gz.
Delta vs F01 baseline (757 041 / 197 340): +639 B raw, +168 B gz — pure refactor, effectively zero bundle impact.
Verdict: PASS

## Verdict: PASS
