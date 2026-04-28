# QA iteration 1 — F27 vault-indexer-dirty-queue

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
Summary: 56 files, 467/467 tests pass (27 new: 4 indexHeader + 6 dirtyQueue + 4 chunkIteration + 13 vaultIndexer).
Verdict: PASS

## Build
Command: `node esbuild.config.mjs production`
Exit: 0
Artifact: `main.js` — 243 KB (unchanged; indexer modules tree-shake until wired in main.ts).
Verdict: PASS

## Verdict: PASS
