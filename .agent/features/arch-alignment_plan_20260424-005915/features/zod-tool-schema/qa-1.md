# QA iteration 1 — F01 zod-tool-schema

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
Test Files: 117 passed (117)
Tests: 1091 passed (1091) — includes 12 net-new tests (6 `zodAdapter` + 6 `toolRegistrySnapshot`).
Verdict: PASS

## Build
Command: `npm run build`
Exit: 0
Output: `main.js` = 757 041 B raw / 197 340 B gz.
Delta vs baseline: +309 131 B raw, +61 744 B gz (+45.5 %). Zod-only cost; in line with expectation after Q4 override.
Verdict: PASS

## Verdict: PASS
