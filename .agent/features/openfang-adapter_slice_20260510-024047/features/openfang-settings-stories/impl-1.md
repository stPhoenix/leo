# Impl iteration 1 — F07 openfang-settings-stories

## Summary
Added 4 new Storybook stories under `Settings/ExternalAgentsSection` mounting an `AdapterRegistry` containing only `OpenfangAdapter`: `OpenfangConfigured`, `OpenfangSecretRevealed` (with a `play` function that clicks the Reveal toggle), `OpenfangDisabled`, and `OpenfangInvalidBaseUrl`. No new component code; relies on `ExternalAgentsSection`'s schema-driven form rendering.

## Files touched
- `src/settings/ExternalAgentsSection.stories.tsx` — imported `OpenfangAdapter` + `userEvent`/`within` from `storybook/test`; added 4 stories using a shared `OPENFANG_CONFIG` literal.

## Tests added or updated
- AC1/2/3/4/5 are visual stories (verified to typecheck + lint clean). Existing DOM test suite `tests/dom/externalAgentsSection.test.tsx` (8 tests) still passes — proves the section component handles the schema shape openfang adds.

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
- Used `storybook/test` (not `@storybook/test`) — matches the existing convention in `src/ui/chat/InlineConfirmation.stories.tsx`.
- `pnpm build-storybook` fails on a pre-existing transitive import from `@langchain/anthropic` (verified by `git stash` + clean-tree retest). Not our regression. AC1 is a `pnpm storybook` (dev) check; the dev server is unaffected (esbuild dev path resolves the module).

## Assumptions
- `OPENFANG_CONFIG` matches the schema defaults from F01 (sessionId optional, baseUrl strips trailing slash transparently).
- Reveal-button aria-label `Toggle reveal for apiKey` is what `ExternalAgentsSection` emits (matched against `src/settings/ExternalAgentsSection.tsx:297,530`).

## Open questions
None.
