# QA iteration 1 — F28 chunking-metadata

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
Summary: 57 files, 485/485 tests pass (18 new `chunker` cases).
Verdict: PASS

## Build
Command: `node esbuild.config.mjs production`
Exit: 0
Artifact: `main.js` — 243 KB (unchanged; pure module tree-shakes until F29 consumes it).
Verdict: PASS

## Verdict: PASS
