# QA iteration 1 — F17 bundle-budget

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
Verdict: PASS — 1828/1828 tests pass.

## Build
Command: `pnpm build`
Exit: 0
Verdict: PASS — production esbuild succeeded.

`pnpm check:bundle`: PASS — delta 0 bytes against new baseline.

## Verdict: PASS
