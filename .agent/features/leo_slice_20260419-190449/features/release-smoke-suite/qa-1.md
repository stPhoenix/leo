# QA iteration 1 — F57 release-smoke-suite

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
Result: 987 passed (96 files, +4 from F56 baseline)
Verdict: PASS

## Build
Command: `pnpm run build`
Exit: 0
Artifact: `main.js` ~254 KB (unchanged — smoke fixture + docs are test-only).
Verdict: PASS

## Smoke (release gate)
Command: `pnpm run smoke`
Exit: 0
Result: 4 passed (1 file)
Verdict: PASS

## Verdict: PASS
