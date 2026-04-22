# QA iteration 1 — F11 chat-message-queue

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
Summary: 28 test files, 230/230 tests pass (new: 6 `turnDispatcher`, 4 `composerInput` queue cases, 1 rewritten).
Verdict: PASS

## Build
Command: `node esbuild.config.mjs production`
Exit: 0
Artifact: `main.js` ≈ 198 KB (203012 bytes)
Verdict: PASS

## Verdict: PASS
