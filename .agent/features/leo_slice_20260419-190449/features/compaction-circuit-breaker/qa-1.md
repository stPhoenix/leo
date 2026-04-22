# QA iteration 1 — F45 compaction-circuit-breaker

## Typecheck
Command: `pnpm run typecheck`
Exit: 0
Verdict: PASS

## Lint
Command: `pnpm run lint`
Exit: 0
Verdict: PASS

## Tests
Command: `pnpm run test`
Exit: 0
Result: 854 passed (84 files, +15 from F44 baseline)
Verdict: PASS

## Build
Command: `pnpm run build`
Exit: 0
Artifact: `main.js` ~254 KB (unchanged — breaker module tree-shaken until `main.ts` wires the tracking state).
Verdict: PASS

## Verdict: PASS
