# QA iteration 1 — F08 editor-bridge-focused-context

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
Summary: 23 test files, 192/192 tests pass (new: 6 `debounce`, 14 `editorBridge`).
Verdict: PASS

## Build
Command: `node esbuild.config.mjs production`
Exit: 0
Artifact: `main.js` ≈ 189 KB (193614 bytes)
Verdict: PASS

## Verdict: PASS
