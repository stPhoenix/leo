# F02 · rag-widget — `rag` widget component + Storybook

## Purpose

Render the `RagSnapshot` produced by [F01](../rag-snapshot/feature.md) as a read-only chat widget under the existing `registerWidget` mechanism, and ship a Storybook entry that exercises every visual state in isolation. Covers [FR-02](../../context.md#functional-requirements), [FR-05](../../context.md#functional-requirements), [FR-09](../../context.md#functional-requirements), [NFR-04](../../context.md#non-functional-requirements), [NFR-05](../../context.md#non-functional-requirements), [NFR-06](../../context.md#non-functional-requirements).

## Scope

In scope:

- New file `src/ui/chat/widgets/RagWidget.tsx`:
  - Exports `RagWidgetPayload` (`{ snapshot: RagSnapshot }` re-using the F01 type).
  - Exports `RagWidget` component (named export only) that calls `registerWidget('rag', RagWidget)` at module scope, mirroring `ContextWidget.tsx`.
  - Pure render — no `useEffect`, no subscriptions; the snapshot is the only input.
- Visual states rendered by the same component, branched on `snapshot.storeAvailable`, `snapshot.indexerStatus.phase`, and zero counts:
  - **idle populated** — counts, model, dim, exclude/graph metadata, no progress row.
  - **indexing** — same as idle plus a progress row with `remaining`, `currentPath`, label "Indexing…".
  - **paused on user / errored** — show `lastError` (truncated) and dim the counts.
  - **unavailable** — render only the unavailable banner ([FR-05](../../context.md#functional-requirements)) plus indexer status if any.
  - **empty vault** — counts of `0`, model still shown if header exists, with a hint line "No notes indexed yet" ([FR-06](../../context.md#functional-requirements)).
  - **large vault** — uses `Number.toLocaleString('en-US')` formatting (mirrors `ContextWidget`'s `fmt`).
- New file `src/ui/chat/widgets/RagWidget.stories.tsx`:
  - One story per state listed above (covers [FR-09](../../context.md#functional-requirements)).
  - Reuses the existing Storybook preview / obsidian CSS vars setup (no new infra).
- CSS / Tailwind utilities scoped under `.leo-root` with class names prefixed `leo-rag-widget-*` ([NFR-05](../../context.md#non-functional-requirements)). New rules (if needed) added to `styles.css` next to existing `leo-context-widget-*` rules.

Out of scope:

- Snapshot collection logic (lives in F01).
- Slash command registration (lives in F03).
- Live-refresh / polling — the widget is a pure function over its prop ([NFR-06](../../context.md#non-functional-requirements)).
- DOM tests beyond Storybook coverage; full DOM interaction tests are not required for v1 (state matrix is exhausted via Storybook fixtures + visual review). A lightweight smoke render test is acceptable but optional.

## Acceptance criteria

1. The component is registered exactly once at module evaluation as `registerWidget('rag', RagWidget)`; importing the module twice does not throw because `registerWidget` is idempotent on the same `kind` (it overwrites in `Map.set`) — but the wiring side ([F03](../rag-slash-command/feature.md)) imports it from a single barrel/path so this never matters in practice ([FR-02](../../context.md#functional-requirements)).
2. Given a `RagSnapshot` with `storeAvailable: false`, the rendered DOM contains an element with `data-slot="rag-unavailable"` and the reason text; the populated counts table is not rendered ([FR-05](../../context.md#functional-requirements)).
3. Given a snapshot with `chunkCount === 0` and `storeAvailable: true`, the rendered DOM contains `data-slot="rag-empty"` and shows zero counts plus a hint ([FR-06](../../context.md#functional-requirements)).
4. Given a snapshot with `indexerStatus.phase === 'draining'`, the rendered DOM contains `data-slot="rag-progress"` with the remaining count and current path basename, and is hidden in idle/empty/unavailable states ([FR-07 boundary](../../context.md#functional-requirements)).
5. All numeric counts render via locale-aware formatting (e.g. `12,345` for `12345`).
6. The component does not import `obsidian`, `idb`, or any module under `src/storage/` directly; it imports `RagSnapshot` from F01's module and types only ([NFR-06](../../context.md#non-functional-requirements), [layer rule](../../../../architecture/architecture.md#2-layer-diagram)).
7. Storybook entries: one story per state — `Idle`, `IndexingInProgress`, `PausedOnUser`, `Unavailable`, `Empty`, `LargeVault`. Each renders without console errors and without any module-load order dependency ([FR-09](../../context.md#functional-requirements)).
8. Style classes use `leo-rag-widget-*` prefix; no `!important`; obsidian CSS variables used for colour tokens ([NFR-05](../../context.md#non-functional-requirements)).
9. Bundle delta is dominated by the new component + stories file; no new runtime dependency added to `package.json` ([NFR-04](../../context.md#non-functional-requirements)).
10. All component code uses named exports, function components, and follows the [hooks order rule](../../../../standards/code-style.md#react-18) — though for v1 the component is hookless.

## Dependencies

- Depends on [F01 · rag-snapshot](../rag-snapshot/feature.md) for the `RagSnapshot` type.
- Depends on context: [FR-02](../../context.md#functional-requirements), [FR-05](../../context.md#functional-requirements), [FR-09](../../context.md#functional-requirements), [NFR-04](../../context.md#non-functional-requirements), [NFR-05](../../context.md#non-functional-requirements), [NFR-06](../../context.md#non-functional-requirements).

## Implementation notes

- Mirror the structural choices of `ContextWidget.tsx` referenced from [§3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) — same `WidgetComponentProps` adapter, same `registerWidget` call at module scope, same locale formatter pattern.
- For Tailwind + obsidian CSS variable usage, follow [styling rules](../../../../standards/code-style.md#styling-tailwind--obsidian).
- For Storybook layout, conform to the existing `*.stories.tsx` examples in `src/ui/chat/` and the [tech-stack tooling section](../../../../standards/tech-stack.md#tooling--quality) — Vitest is unrelated here, but Storybook scripts are listed in `package.json`.
- Keep the component pure per [§3 Modules · UI](../../../../architecture/architecture.md#3-modules) — UI receives data, never reaches into adapters.
- Follow the [comments policy](../../../../standards/code-style.md#comments--docs) — no comments unless a non-obvious why.

## Open questions

- **OQ-F02-1** — Should the widget visually mimic `ContextWidget`'s donut, or a simpler stat-table layout? Default: stat-table (vault size, chunk count, model, dim, graph nodes, exclude rules, approx vector bytes), with a small horizontal progress bar reused for indexing state. Donut is overkill for read-only counts and bloats CSS.
- **OQ-F02-2** — Is a smoke `*.test.tsx` (DOM render) under `tests/dom/` worth adding alongside Storybook? Default: no for v1, since each visual state is already covered by an isolated Storybook fixture. Add only if reviewer explicitly asks.
