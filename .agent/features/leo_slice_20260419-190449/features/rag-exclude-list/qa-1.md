# QA iteration 1 — F32 rag-exclude-list

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
Summary: 65 files, 548/548 tests pass (17 new across 4 test files).
Verdict: PASS

## Build
Command: `node esbuild.config.mjs production`
Exit: 0
Artifact: `main.js` — 243 KB (minimatch adds to bundle only when reachable — still tree-shaken today; will land when RAGEngine/VaultIndexer are constructed in main.ts).
Verdict: PASS

## Verdict: PASS
