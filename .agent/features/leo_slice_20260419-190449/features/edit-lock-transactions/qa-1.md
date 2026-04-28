# QA iteration 1 — F18 edit-lock-transactions

## Typecheck
Command: `tsc --noEmit`
Exit: 0
Verdict: PASS

## Lint
Command: `eslint "src/**/*.{ts,tsx}" "tests/**/*.{ts,tsx}"`
Exit: 0
Verdict: PASS

## Tests
Command: `vitest run`
Exit: 0
Summary: 41 test files, 343/343 tests pass (13 new `editLock` cases covering controller invariants, highlight timers, and withLock orchestrator).
Verdict: PASS

## Build
Command: `node esbuild.config.mjs production`
Exit: 0
Artifact: `main.js` ≈ 221 KB (226345 bytes; unchanged because the F18 modules are not yet imported by `main.ts` — F20 will wire them).
Verdict: PASS

## Verdict: PASS
