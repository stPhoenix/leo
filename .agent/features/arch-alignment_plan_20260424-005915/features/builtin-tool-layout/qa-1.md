# QA iteration 1 — F03 builtin-tool-layout

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
Tests: 1095 passed (1095) — no test count change from F02.
Verdict: PASS

## Build
Command: `npm run build`
Exit: 0
Output: `main.js` = 757 850 B raw / 197 515 B gz.
Delta vs F02 (757 680 / 197 508): +170 B raw, +7 B gz — essentially identical; filename noise in the esbuild output is the only difference.
Verdict: PASS

## Verdict: PASS
