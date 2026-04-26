# Impl iteration 1 — F02 rag-widget

## Summary

Shipped the `rag` widget React component (mirroring the `ContextWidget` pattern), its CSS rules under `.leo-rag-widget-*`, and a Storybook stories file covering all required visual states. The component is a pure function over a `RagSnapshot` prop and registers itself in the widget registry at module load via `registerWidget('rag', RagWidget)`.

## Files touched

- `src/ui/chat/widgets/RagWidget.tsx` — new component + `RagWidgetPayload` type re-using `RagSnapshot` from F01; internal helpers `RagWidgetHeader`, `RagProgressRow`, `RagStatTable`, `RagUnavailable`, `RagEmpty`, `RagAlert`; locale-aware `fmt` and human-readable `fmtBytes`; `pickVariant(snapshot)` derives the visible variant from store availability + indexer phase + chunk count.
- `src/ui/chat/widgets/RagWidget.stories.tsx` — new Storybook entry with seven stories: `Idle`, `IndexingInProgress`, `PausedOnUser`, `Errored`, `Unavailable`, `Empty`, `LargeVault`.
- `styles.css` — appended `.leo-rag-widget-*` rule block right after the existing `.leo-context-widget` rules. Uses Obsidian CSS variables (`--text-normal`, `--text-accent`, `--text-error`, `--color-yellow`, `--color-red`, `--background-modifier-border`, `--font-interface`, `--font-ui-smaller`, `--radius-l`, `--radius-m`, `--radius-s`, `--size-4-*`) — no hard-coded colours, no `!important`.

## Tests added or updated

No new tests in this iteration. The acceptance criteria call for Storybook coverage of every visual state (AC7) and explicitly mark a DOM smoke test as optional in the feature's open question OQ-F02-2 (defaulted to "no" by feature.md). Storybook fixtures now exercise every variant; if reviewer asks for a DOM smoke test we will add one in a follow-up iteration.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- The component intentionally branches into an extra `paused` and `errored` visual variant (showing a yellow/red alert above the stat table) so the user can read the indexer's `lastError` directly from the widget. The feature spec only lists "paused on user / errored" as a single variant — implementation refines this into two clearly-labelled sub-variants while preserving the same data contract. Stories cover both.
- Tailwind utilities not used; the styles live entirely in `styles.css` under the `leo-rag-widget-*` namespace, mirroring the existing `ContextWidget`. The project standards guide allows custom CSS when utilities are insufficient ([code-style.md Styling section](../../../../standards/code-style.md#styling-tailwind--obsidian)) and the `ContextWidget` precedent already established this pattern; introducing Tailwind here would be a larger refactor.
- Resolved `OQ-F02-1` ("donut vs stat-table layout") in favour of stat-table, matching the feature default.
- Resolved `OQ-F02-2` ("smoke DOM test alongside Storybook") in favour of "no" — Storybook fixtures cover every variant and the spec marks DOM tests optional.

## Assumptions

- `RagWidgetPayload` carries the snapshot under `{ snapshot }` (object form). F03 must follow this shape when appending the widget message: `widget: { kind: 'rag', props: { snapshot } }`.
- The widget reads `snapshot.indexerStatus.phase` and `snapshot.storeAvailable` as the variant drivers; `chunkCount === 0` resolves to the `empty` variant only when the indexer is also idle.
- Storybook fixtures encode reasonable units: `vectorBytesApprox = chunkCount × dim × 4` and `textBytesApprox` filled with realistic values to exercise the byte-formatter.

## Open questions

None blocking.
