# QA iteration 1 — F44 compaction-ptl-retry

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
Result: 839 passed (83 files, +21 from F43 baseline)
Verdict: PASS

## Build
Command: `pnpm run build`
Exit: 0
Artifact: `main.js` ~254 KB (unchanged — PTL retry module is tree-shaken from bundle until a runtime consumer imports it).
Verdict: PASS

## Verdict: PASS
