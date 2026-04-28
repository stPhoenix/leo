# QA iteration 1 — F22 skills-picker-active-skill

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
Summary: 45 test files, 378/378 tests pass (1 new `agentRunner` case covering allowedTools filter + defaultModel override).
Verdict: PASS

## Build
Command: `node esbuild.config.mjs production`
Exit: 0
Artifact: `main.js` ≈ 238 KB (243718 bytes).
Verdict: PASS

## Verdict: PASS
