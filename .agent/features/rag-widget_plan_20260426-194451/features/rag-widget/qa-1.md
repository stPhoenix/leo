# QA iteration 1 — F02 rag-widget

## Typecheck
Command: `pnpm typecheck` (`tsc --noEmit`)
Exit: 0
Verdict: PASS

## Lint
Command: `pnpm lint` (`eslint "src/**/*.{ts,tsx}" "tests/**/*.{ts,tsx}"`)
Exit: 0
Verdict: PASS

## Tests
Command: `pnpm test` (`vitest run`)
Exit: 0
Result: 152 test files / 1351 tests passed.
Verdict: PASS

## Build
Command: `pnpm build` (`node esbuild.config.mjs production`)
Exit: 0
Verdict: PASS

## Verdict: PASS
