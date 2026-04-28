# Impl iteration 1 — F30 indexer-ui-controls

## Summary

Landed the three user-facing indexer controls as testable, host-agnostic modules. (1) Added `VaultIndexer.subscribe(listener)` + `DrainEvent` type + `reindexAll()` + `isWaitingOnUser()` / `resumeFromWait()` helpers so F30 consumers can observe drain state and trigger a full reindex without reaching into `DirtyQueue` directly. (2) `IndexerStatusBar` at `src/indexer/indexerStatusBar.ts` is a non-React DOM presenter — takes a host element (`Plugin.addStatusBarItem()` result at runtime), subscribes to drain events, rAF-throttles multiple ticks into one paint, renders `Indexing: <n> files left - <basename>` with a `<collapseWidthPx=140` shortened variant, and attaches `role="status" aria-live="polite"` + optional `setIcon('database')`. (3) `ReindexService` at `src/indexer/reindexService.ts` is a thin application-service shim — `reindexVault()` confirms through the injected `confirmReindex` callback, rebuilds the F29 VectorStore (when wired), then calls `indexer.reindexAll()`; `handleModelSwitch(prev)` routes `now`/`later`/`revert` via injected `confirmModelSwitch` + `revertModelSetting` callbacks; in-flight flag debounces rapid double-clicks. (4) `IndexEmptyStateCta` at `src/ui/chat/IndexEmptyStateCta.tsx` is a React component that consumes a `hasIndex` source + optional `drainSubscribe` to auto-unmount on first `drain.complete`. All runtime Obsidian glue (`Plugin.addStatusBarItem`, `Plugin.addCommand`, `Notice`, settings-change listener) is deferred to the `main.ts` wire-up — each module takes its external surface as DI so unit tests run under happy-dom without Obsidian.

## Files touched

- `src/indexer/vaultIndexer.ts` — added `DrainEvent` / `DrainListener` type, `subscribe()`, `reindexAll()`, `isWaitingOnUser()`, `resumeFromWait()`; drain hooks emit `start` / `tick` / `complete` to all subscribers; listener exception isolation via try/catch.
- `src/indexer/indexerStatusBar.ts` — new `IndexerStatusBar` class.
- `src/indexer/reindexService.ts` — new `ReindexService` with `reindexVault` + `handleModelSwitch`.
- `src/ui/chat/IndexEmptyStateCta.tsx` — new React component consuming `IndexStatusSource` + optional `drainSubscribe`.
- `tests/unit/indexerStatusBar.test.ts` — 6 cases (hidden at idle, full label + collapsed label render, DOM-removed on complete, rAF throttling coalesces 3 ticks to 1 paint, dispose unsubscribes).
- `tests/unit/reindexService.test.ts` — 7 cases (cancel no-op, confirm reindexes, rebuild precedes reindex, in-flight debounce, model-switch `now`/`revert`/`later`).
- `tests/dom/indexEmptyStateCta.test.tsx` — 5 cases (no-render when index present, render + button when absent, click callback, unmount on drain.complete, re-render on hasIndex flip).
- `tests/unit/vectorStore.test.ts` — fixed `CorruptIndexError` import to `import type` per eslint consistent-type-imports.

## Tests added or updated

- 18 new cases. Full suite: 61 files, 515/515 pass.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **Command-palette registration itself is deferred to `main.ts`.** `ReindexService.reindexVault()` is the command handler; the `Plugin.addCommand({id:"leo-reindex-vault", name:"Leo: Re-index vault", callback: () => svc.reindexVault()})` binding lives in the Obsidian-runtime wire-up alongside the F24/F25/F26/F27/F29 carry-over. The service is verified via direct unit tests.
- **`Notice`-based confirmation UI is an injected callback.** `confirmReindex` and `confirmModelSwitch` are async functions returning their choice literal; the `main.ts` wire-up implements them with Obsidian's `Notice` with inline buttons (matching F27's startup header-mismatch pattern). Keeps the service unit-testable under happy-dom.
- **Status-bar collapsed-width detection** uses `getBoundingClientRect().width` synchronously rather than a `ResizeObserver` callback — feature Open questions flagged the ResizeObserver path but it adds runtime complexity (observer lifecycle + debounce) for a threshold-only decision. Synchronous read at render time is sufficient for the 140 px threshold.

## Assumptions

- `hasIndex()` signal in `IndexStatusSource` is driven by `VectorStore.listHeader() !== null` — the `main.ts` wire-up bridges the two and fires the subscribe callback after every `writeHeader` / `rebuild`.
- `reindexAll()` also triggers `queryOnDemand` internally (already implemented in F27) so progress renders immediately.
- `IndexEmptyStateCta` is mounted inside the `ChatView` empty-thread region by the F04 wire-up; this iteration does NOT auto-mount into `ChatRoot` because the F04 empty-thread mounting plan is still fluid. Explicit mount slot is the caller's responsibility.

## Open questions

- **Command-palette + Notice wiring in `main.ts`** — carry-over alongside earlier features.
- **Shared `ReindexPromptService` helper with F27** — feature Open questions flagged this; current implementation has F27 own the startup header-mismatch prompt and F30 own the settings-driven model-switch prompt, each with their own injected callbacks. Could consolidate on a single helper once `main.ts` has both copies in one file.
