# Impl iteration 1 — F06 wiki-widget-framework

## Summary
Stood up the phase-dispatched wiki widget framework: pure `WikiViewModel` + `WikiPhase` literal union, `WikiWidgetController` with subscribe/update/setPhase/action-forwarding/dispose, Zod-validated `WikiTerminalSnapshot` (schemaVersion=1), `WikiWidget` React block dispatching on phase, `WikiLiveBlock` (registers under `WIKI_LIVE_KIND`), `WikiTerminalBlock` (registers under `WIKI_TERMINAL_KIND`). Reload rehydration goes through `WikiWidgetController.reloadRehydrate` which seeds `phase='error', error.code='reload'`. Block kinds are registered with the widget registry via side-effect imports from `main.ts`.

## Files touched
- `src/agent/wiki/widgetState.ts` — `WikiPhase`, `WikiViewModel`, `TERMINAL_WIKI_PHASES`, `makeInitialViewModel`, `isTerminal`, plus typed sub-shapes (`RefineTurn`, `ProgressCounts`, `DuplicatePrompt`, `PlanSourceSummary`, `LintFindingSummary`, `PerSourceStatus`).
- `src/agent/wiki/terminalSnapshot.ts` — `WIKI_TERMINAL_KIND`, `WikiTerminalSnapshotSchema` (Zod, schemaVersion 1, defaulted counts), `buildWikiTerminalSnapshot`, `tryParseWikiTerminalSnapshot`.
- `src/agent/wiki/widgetController.ts` — `WikiWidgetController` with `viewModel/subscribe/update/setPhase/recordError/toTerminalSnapshot/cancel/answerClarification/resolveDuplicate/applyLintConfirm/dispose`, plus static `reloadRehydrate`.
- `src/ui/chat/blocks/WikiWidget.tsx` — phase-dispatched view (refining transcript, clarify form, progress bars for fetch/persist/extract/reduce/write/check, duplicate prompt, plan list, scan summary, confirm list with Accept-all/Reject-all, terminal summary, error block) using `useSyncExternalStore`.
- `src/ui/chat/blocks/WikiLiveBlock.tsx` — registers `WIKI_LIVE_KIND` widget; looks up live controller from `liveControllerRegistry` (F04) and falls back to `reloadRehydrate` when missing.
- `src/ui/chat/blocks/WikiTerminalBlock.tsx` — registers `WIKI_TERMINAL_KIND` widget; collapsed one-line summary toggling to expanded `<dl>` with per-phase counts, log line, error.
- `src/ui/chat/blocks/WikiWidget.stories.tsx` — Storybook stories for every phase variant + cancelled + reload-error + lint awaiting_confirm + done.
- `src/main.ts` — side-effect imports `'@/ui/chat/blocks/WikiLiveBlock'` and `'@/ui/chat/blocks/WikiTerminalBlock'` so widget registration runs at plugin load.

## Tests added or updated
- `tests/unit/wikiWidgetController.test.ts` — initial state; subscribe + unsubscribe; setPhase stamps started/ended; reloadRehydrate produces error.code=reload; terminal snapshot is Zod-valid (sourcesPersisted counts only ok+replaced); action forwarding to optional callbacks; dispose stops listener fire (AC1, AC3, AC5, AC6).
- `tests/unit/wikiTerminalSnapshot.test.ts` — schema parses minimal payload with defaulted counts; rejects unknown terminalPhase; tryParse returns null on malformed; JSON round-trip identity; build from done ingest counts persisted = ok+replaced; build from error sets durationMs=0 when times missing (AC6).
- `tests/dom/wikiWidget.test.tsx` — refining transcript renders; clarify form forwards answer; fetch progress shows `n / total`; duplicate buttons forward decision; awaiting_confirm Accept-all forwards finding ids; error block; terminal block collapsed→expanded toggle; terminal block invalid-payload fallback; live block renders registered controller; live block reload-rehydrates when controller missing (AC1, AC2, AC4, AC5).

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
- Storybook coverage is in one `WikiWidget.stories.tsx` file (the spec said per-block stories implicitly). Combining into one file keeps state-machine variants visible side-by-side. AC7 is the substance: every variant has a story.
- `OQ-5` (diff-render of SCHEMA.md patches): not implemented in v1; the awaiting_confirm body emits a one-line "SCHEMA.md patch included — confirm explicitly" notice. Diff rendering can be wired later by extending `ConfirmBody`.

## Assumptions
- Per-source statuses encoded as `'ok' | 'skipped' | 'replaced' | 'error'`. `sourcesPersisted` counts ok+replaced (skipped doesn't write a new raw entry; error doesn't either).
- Reload rehydrate is the only path that produces `error.code='reload'`. F11/F18 will detect a non-terminal phase at reload and route through `WikiWidgetController.reloadRehydrate` rather than restoring serialized live state — matches NFR-02 ("subgraph state in-memory only; plugin reload during non-terminal phase discards run").

## Open questions
- OQ-5 — diff-render of SCHEMA.md patches — deferred per spec ("recommend yes from day one if the diff renderer is cheap to reuse"). Will revisit after F19 ships its confirm UI.
