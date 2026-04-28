# Impl iteration 1 — F14 storybook-mocks

## Summary

Extended `src/ui/chat/__stories__/mocks/sources.ts` with the live-status-specific mock factories — `makeRunStateStore` (accepts `inProgress`/`resolved`/`errored`/`rejected`/`canceled`/`progress`/`permissions` arrays), `mockProgressEvents(toolUseId, kind, count)`, `mockEditDiff` (before/after fixture for F12 stories), `mockClock(t0)` (frozen + advance + injectable setInterval/clearInterval — used by tests and stories that exercise blink/shimmer/stalled timing), plus a typed `exampleToolUseBlocks` content-block fixture. Verified `pnpm build-storybook` produces a clean static build.

## Files touched

- `src/ui/chat/__stories__/mocks/sources.ts` — new exports listed above.

## Tests added or updated

Existing test suite + Storybook build. No new dedicated tests in this iteration; the mocks are exercised by per-feature story files (F04 / F05 / F06 / F07 / F08 / F09 / F10 / F11 / F12) and `pnpm build-storybook` validates them.

## Addressed gaps from previous iteration

Not applicable.

## Deviations from feature.md

- The new Storybook decorators (`withObsidianVars`, `withClock`, `withMockMarkdown`) listed in F14 ui.md are partially present in the existing `.storybook/preview.ts` (theme decorator + `leo-chat` wrapper + obsidian-vars CSS). No additional decorator files added — preview.ts already provides equivalent behaviour via the global decorator + CSS imports. `withClock` is offered as the `mockClock` helper that stories can pass into the components that accept clock-injection props (e.g. `BottomLiveIndicator.setInterval`).
- No `sources.stories.tsx` meta-story; the per-feature stories serve as the discoverability surface.

## Assumptions

- Storybook glob in `.storybook/main.ts` (`src/**/*.stories.@(ts|tsx|mdx)`) auto-discovers all 9 new story files shipped across F04–F12.
- `obsidian` and `@langchain/langgraph` aliases configured in `.storybook/main.ts` continue to point at mocks; no new alias work needed.

## Open questions

- Whether to publish a `withClock` decorator with addon-controls for time scrubbing. Defer; current `mockClock` covers the Vitest path.
- Whether to add a documentation MDX page. Defer per CLAUDE.md operating rule §5.
