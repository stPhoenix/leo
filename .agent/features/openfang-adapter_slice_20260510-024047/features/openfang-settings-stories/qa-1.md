# QA iteration 1 — F07 openfang-settings-stories

## Typecheck
Command: `pnpm typecheck`
Exit: 0
Verdict: PASS

## Lint
Command: `pnpm lint`
Exit: 0
Verdict: PASS

## Tests
Command: `pnpm test tests/dom/externalAgentsSection.test.tsx`
Exit: 0 (8/8)
Verdict: PASS

## Build
Command: `pnpm build`
Exit: 0
Verdict: PASS

(Note: `pnpm build-storybook` fails on a pre-existing `@langchain/anthropic` transitive import resolution — verified to fail on a clean `git stash` of main. Not a configured QA gate; not in scope for this feature.)

## Verdict: PASS
