# QA iteration 1 — F04 langgraph-stategraph

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
Test Files  118 passed (118)
     Tests  1095 passed (1095)
Verdict: PASS

## Build
Command: `node esbuild.config.mjs production`
Exit: 0
Bundle size: main.js = 1,469,670 bytes (≈1.40 MiB) — within the 1.5 MB tech-stack budget.
Verdict: PASS

## Verdict: PASS
