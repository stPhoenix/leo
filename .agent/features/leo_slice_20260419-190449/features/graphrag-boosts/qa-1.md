# QA iteration 1 — F35 graphrag-boosts

## Typecheck
Command: `pnpm typecheck`
Exit: 0
Verdict: PASS

## Lint
Command: `pnpm lint`
Exit: 0
Verdict: PASS

## Tests
Command: `pnpm test`
Exit: 0
Summary: 70 files / 625 tests passed (0 failing). +25 new tests vs F34 baseline (600).
Verdict: PASS

## Build
Command: `pnpm build`
Exit: 0
Artifact: `main.js` 249 069 bytes (unchanged from F34) — GraphTraversal / applyBoosts / boost-pass tree-shaken in if not yet wired from main.ts.
Verdict: PASS

## Verdict: PASS
