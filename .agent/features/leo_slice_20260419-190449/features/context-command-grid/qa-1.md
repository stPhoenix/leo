# QA iteration 1 — F47 context-command-grid

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
Result: 884 passed (86 files, +18 from F46 baseline)
Verdict: PASS

## Build
Command: `pnpm run build`
Exit: 0
Artifact: `main.js` ~254 KB (unchanged — grid + command modules tree-shaken until `main.ts` registers the palette command and the composer submit path dispatches the slash regex).
Verdict: PASS

## Verdict: PASS
