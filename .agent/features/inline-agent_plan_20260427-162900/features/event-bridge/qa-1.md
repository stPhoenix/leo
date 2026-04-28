# QA iteration 1 — F05 event-bridge

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
Verdict: PASS — 1672/1672 tests passed (183 files), including new `eventBridge.test.ts` (19 cases) and the loggingPolicy test still green over the new namespace registrations.

## Build
Command: `pnpm build`
Exit: 0
Verdict: PASS — esbuild production build succeeded.

## Verdict: PASS
