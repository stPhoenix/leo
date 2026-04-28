# QA iteration 1 — F30 indexer-ui-controls

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
Summary: 61 files, 515/515 tests pass (6 new `indexerStatusBar` + 7 new `reindexService` + 5 new `indexEmptyStateCta`).
Verdict: PASS

## Build
Command: `node esbuild.config.mjs production`
Exit: 0
Artifact: `main.js` — 243 KB (unchanged; status bar + service + CTA + drain subscribe tree-shake until wired into main.ts).
Verdict: PASS

## Verdict: PASS
