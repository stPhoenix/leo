# QA iteration 1 — F21 skills-loader-builtin

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
Summary: 45 test files, 377/377 tests pass (13 new `skillsStore` cases covering parse + store semantics).
Verdict: PASS

## Build
Command: `node esbuild.config.mjs production`
Exit: 0
Artifact: unchanged (modules not wired into main.ts this iter; F22 will wire).
Verdict: PASS

## Verdict: PASS
