# QA iteration 1 — F08 package-metadata-truth

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
Test Files  118 passed (118)
     Tests  1095 passed (1095)
Verdict: PASS

## Build
Command: `node esbuild.config.mjs production`
Exit: 0
Bundle size: main.js = 1,468,024 bytes raw / 394,428 bytes gzipped.
Verdict: PASS

## Install
Command: `pnpm install`
Exit: 0
Output: "Lockfile is up to date, resolution step is skipped / Already up to date."
Verdict: PASS (replaces AC2 `npm ci`; pnpm is the project-standard installer per tech-stack.md).

## Verdict: PASS
