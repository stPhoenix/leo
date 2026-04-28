# QA iteration 1 — F06 chat-composer-input

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
Summary: 19 test files passed · 145/145 tests passed · composer suite adds 21 cases.
Verdict: PASS

## Build
Command: `pnpm build` (`node esbuild.config.mjs production`)
Exit: 0
Output: `main.js` — 183 700 bytes (~179 KB)
Verdict: PASS

## Verdict: PASS
