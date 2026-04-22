# Impl iteration 1 — F27 vault-indexer-dirty-queue

## Summary

Landed the lazy, resumable VaultIndexer orchestrator spine in three layered modules: `src/indexer/indexHeader.ts` reads/writes `<vault>/.leo/index/header.json` through the F14 `VaultAdapter` and exposes `headerMatches` + `diffManifest` pure helpers; `src/indexer/dirtyQueue.ts` owns a set-backed dedupe queue with debounced atomic-write persistence to `<vault>/.leo/index/queue.json` (version-gated schema `{version:1, paths:string[]}`, rehydrates on load so partial first-index survives restart per NFR-PERF-04); `src/indexer/vaultIndexer.ts` owns the orchestrator — `init()` loads the queue → reads the header → prompts `now/later/revert-model` on mismatch → runs the diff sweep → registers vault listeners → schedules idle drain; `enqueueDirty()` applies a markdown-only filter and rejects `.canvas`/`.pdf`/`.png`/binaries with a `indexer.skip.non-markdown` debug log; `processDueWork()` drains via `requestIdleCallback`-scheduled ticks using the pure `chunkIteration(paths, deadline, minBudgetMs)` helper; `queryOnDemand()` pre-empts the idle timer and drains up to `onDemandCap` entries synchronously; mutual exclusion via a single `draining` flag + linked `AbortController` released in `finally`; `shutdown()` aborts in-flight drains and disposes the queue. Rename events fan out to a delete-of-`oldPath` + create-of-`newPath` pair so downstream vector stores can drop stale entries.

## Files touched

- `src/indexer/indexHeader.ts` — new `IndexHeader` type, `readIndexHeader` / `writeIndexHeader`, `headerMatches`, `diffManifest`.
- `src/indexer/dirtyQueue.ts` — new `DirtyQueue` class with debounced persistence + `load/flush/dispose` lifecycle.
- `src/indexer/chunkIteration.ts` — new `chunkIteration` pure util + `createBrowserIdleScheduler` with `setTimeout(fn,1)` fallback polyfill.
- `src/indexer/vaultIndexer.ts` — new `VaultIndexer` class with all seams as DI options (`VaultFileSource`, `VaultEventSource`, `HeaderMismatchPromptFn`, `processPath`, `IdleScheduler`, `isProviderReady`).
- `tests/unit/indexHeader.test.ts` — 4 cases (missing-header null, round-trip, headerMatches truth-table, diffManifest classification).
- `tests/unit/dirtyQueue.test.ts` — 6 cases (add dedupe, flush payload shape, debounce coalescing under fake timers, load rehydrates, remove+clear persist, dispose cancels pending timer).
- `tests/unit/chunkIteration.test.ts` — 4 cases (full-budget pass, mid-drop, zero-budget, empty).
- `tests/unit/vaultIndexer.test.ts` — 13 cases (header.match, each user-choice route, diff sweep, rename pair fan-out, markdown-only rejection, drain happy path, mutual exclusion, abort-releases-flag, queue.json survives restart, on-demand cap, shutdown).

## Tests added or updated

- 27 new cases. Full suite: 56 files, 467/467 pass.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **`NoticeChannel` prompt routed through an injectable `HeaderMismatchPromptFn`** rather than calling Obsidian's `Notice` directly. The feature specifies a blocking `Notice` with three inline choices; because `Notice` is Obsidian-runtime-only and cannot be exercised under happy-dom, the prompt is an injected async function returning `'now' | 'later' | 'revert-model'` that `main.ts` will implement with the real `Notice` at wire-up time.
- **`ProviderManager` readiness** is threaded through `isProviderReady?: () => boolean` option; when false, `processDueWork` / `queryOnDemand` no-op (honoring architecture §7 "LM Studio unreachable pauses indexing"). The concrete ProviderManager-connection-state plumbing is part of the `main.ts` wire-up.
- **Runtime wire-up in `main.ts` is deferred** alongside the F24/F25/F26 carry-over. The module is fully exercised by 27 unit tests; no integration with the live Obsidian Plugin.onload path lands in this slice.

## Assumptions

- `VaultFileSource.listMarkdown()` returns `{path, extension, mtime, size}` entries — the wire-up in `main.ts` maps `app.vault.getMarkdownFiles()` → `TFile.extension` + `TFile.stat.mtime` + `TFile.stat.size` to this shape.
- `VaultEventSource.on(handler)` returns an unsubscribe; the concrete implementation in `main.ts` will wrap `plugin.registerEvent(app.vault.on('create'|'modify'|'delete'|'rename', ...))` and return `unload()` for symmetry. Obsidian's auto-dispose on `plugin.onunload` still fires even if `unsubscribe()` is not explicitly called.
- `requestIdleCallback` polyfill: the default `createBrowserIdleScheduler` uses real `requestIdleCallback` when present, falling back to `setTimeout(fn, 1)` with a synthetic `{timeRemaining: () => 5, didTimeout: false}` deadline for tests and non-Obsidian runtimes.

## Open questions

- **`indexerIdleMs` settings wire-up** — the feature calls for a configurable setting; this iteration accepts `idleMs: () => number` as an injection point. The corresponding `SettingsStore` field / UI row ships with F30 (indexer-ui-controls).
- **`onDemandCap` latency budget (NFR-PERF-03)** — default 32 matches feature Open questions proposal; verifier to pin the final value once F31 (RAG cosine search) measures end-to-end latency against the 200 ms budget.
- **Runtime `main.ts` construction** — parked alongside the F24/F25/F26 wire-up; a dedicated wiring slice will plumb all four plan-mode/indexer modules into `onload`/`onunload` lifecycle hooks in one pass.
