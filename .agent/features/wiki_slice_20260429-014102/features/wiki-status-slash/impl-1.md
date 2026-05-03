# Impl iteration 1 — F03 wiki-status-slash

## Summary
Built `/wiki-status` slash command end to end: pure `collectWikiStatus` reader, abortable `WikiStatusCommandHandle`, `WikiStatusWidget` registered under widget kind `wiki-status`, and `chatView` slash registration. Defined `WikiMutexState` shared types in `mutexTypes.ts` (consumed by F03 now, F05+F07 later) so wiring is functional today and remains stable when F05 lands.

## Files touched
- `src/agent/wiki/mutexTypes.ts` — `WikiOp`, `WikiMutexState`, `WIKI_MUTEX_IDLE`, `WikiMutexLike` shared types.
- `src/agent/wiki/wikiStatus.ts` — `collectWikiStatus({vault,getMutexState})` returning `WikiStatus` (page count, byte size, last lint timestamp + runId, orphan-page + orphan-raw counts, mutex state). Self-contained adjacency walk for orphans.
- `src/ui/wikiStatusCommand.ts` — abort-aware `createWikiStatusCommand` mirroring `createRagCommand`; exports `WIKI_STATUS_WIDGET_KIND`.
- `src/ui/chat/widgets/WikiStatusWidget.tsx` — function component + `registerWidget(WIKI_STATUS_WIDGET_KIND, …)`.
- `src/ui/chat/widgets/WikiStatusWidget.stories.tsx` — Storybook fixtures (Idle / NeverLinted / IngestRunning / LintRunning / EmptyVault).
- `src/ui/chatView.tsx` — added `collectWikiStatus` to `ChatViewDeps`, slash registration `name:'wiki-status'`, `renderWikiStatusAsWidget` append, side-effect import for widget registration.
- `src/main.ts` — wires the slash via `collectWikiStatus({vault, getMutexState: () => this.wikiMutex?.active() ?? WIKI_MUTEX_IDLE})`; private `wikiMutex: WikiMutexLike | null = null` slot ready for F05.

## Tests added or updated
- `tests/unit/wikiStatus.test.ts` — empty-wiki zeroes; index page count + size; last-lint timestamp from log (most-recent lint match, not ingest); orphan-page/orphan-raw counts via real adjacency walk + frontmatter scan; mutex state pass-through.
- `tests/unit/wikiStatusCommand.test.ts` — collect→render path; abort-on-restart cancels pending invocation; error routing.
- `tests/dom/wikiStatusWidget.test.tsx` — renders all six stats, `never` for missing lint, `op runId` + `data-mutex="busy"` when busy.

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
- Result is rendered via the existing widget kind registry rather than a raw markdown chat block. This matches how `/context` and `/rag` already render and gives us a Storybook surface (AC5). Functionally the same surface — an inline assistant block in chat.

## Assumptions
- `WikiMutex.active()` is supplied by F05; for now `main.ts` always reports `idle` via `?? WIKI_MUTEX_IDLE`. When F05 wires `this.wikiMutex` the widget begins surfacing live state automatically — no F03 change needed.
- Last-lint regex assumes log lines of shape `## [<iso>] lint | runId=<id>` per FR-46/FR-38 conventions.

## Open questions
- OQ-4 — "last lint was N days ago" hint deferred (recommend yes per spec, but text-vs-icon presentation intentionally minimal in v1 widget).
