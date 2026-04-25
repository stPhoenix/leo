# Impl iteration 1 — F07 thinking-block-renderer

## Summary

`ThinkingBlockView` was already shipped during F01 with the correct shape (italic dim region, "Thinking" label, collapse-by-default-on-finalise, streaming-expanded, redacted variant showing only byte count). F07 ships dedicated DOM tests for every variant and Storybook stories.

## Files touched

- `tests/dom/thinkingBlockView.test.tsx` — new.
- `src/ui/chat/blocks/ThinkingBlockView.stories.tsx` — new (ExpandedStreaming, CollapsedFinalised, ExpandedFinalisedUser, Redacted).

## Tests added or updated

- `tests/dom/thinkingBlockView.test.tsx` — 4 cases: expanded-while-streaming, collapsed-finalised + toggle, redacted-no-toggle, aria-region semantics.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

None.

## Assumptions

- Streaming/finalised state is encoded by `streaming` boolean prop (controlled by the parent — `AssistantBlocks` passes `isLast && streaming`).

## Open questions

None for F07 itself.
