# QA iteration 1 — F10 agent-controller-core

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
Summary: 27 test files, 220/220 tests pass (new: 6 `truncator`, 3 `contextAssembler`, 9 `agentRunner`).
Verdict: PASS

## Build
Command: `node esbuild.config.mjs production`
Exit: 0
Artifact: `main.js` ≈ 197 KB (201428 bytes)
Verdict: PASS

## Verdict: PASS
