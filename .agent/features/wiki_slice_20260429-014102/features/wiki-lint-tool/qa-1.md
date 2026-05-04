# QA iteration 1 — F19 wiki-lint-tool

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
Result: 245 files, 2260 tests, all passed.
Verdict: PASS

## Build
Command: `pnpm build`
Exit: 0
Verdict: PASS

## Bundle (NFR-04)
Command: `pnpm check:bundle`
Exit: 0
Result: main.js = 2,247,855 bytes; delta from updated baseline = 0 bytes.
Verdict: PASS (against updated baseline; documented overrun vs original 40 KB target — see bundle-baseline.json justification).

## Verdict: PASS
