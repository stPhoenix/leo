# QA iteration 1 — F46 context-analyzer-pipeline

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
Result: 866 passed (85 files, +12 from F45 baseline)
Verdict: PASS

## Build
Command: `pnpm run build`
Exit: 0
Artifact: `main.js` ~254 KB (unchanged — orchestrator tree-shaken until a `/context` command wires it up in F47/F48).
Verdict: PASS

## Verdict: PASS
