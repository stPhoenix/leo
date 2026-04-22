# QA iteration 1 — F12 token-usage-indicator

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
Summary: 30 test files, 250/250 tests pass (new: 11 `tokenUsage`, 4 `turnDispatcher` usage cases, 6 `tokenUsageFooter`).
Verdict: PASS

## Build
Command: `node esbuild.config.mjs production`
Exit: 0
Artifact: `main.js` ≈ 200 KB (204573 bytes)
Verdict: PASS

## Verdict: PASS
