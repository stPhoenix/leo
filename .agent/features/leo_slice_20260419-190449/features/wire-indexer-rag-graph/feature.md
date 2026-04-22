# F58 — Wire indexer + RAG + graph subsystem

## Purpose

Close the integration gap left by F27–F36: VaultIndexer, IndexHeader, DirtyQueue, Chunker, CanvasChunker, ChunkIteration scheduler, VectorStore, ReindexService, IndexerStatusBar, IndexEmptyStateCta, GraphCache, RAGEngine, Scorer, GraphTraversal, ExcludeMatcher, ExcludeListStore, TagMatcher, and the `search_vault` tool all ship and pass domain tests but are not referenced from `src/main.ts`. This feature wires the full indexer → RAG → graph pipeline into the plugin's `onload` / `onunload` lifecycle so the running plugin actually indexes the vault, persists embeddings, maintains the symmetric link graph, serves RAG queries with boost scoring, and exposes the `search_vault` tool to the agent.

## Scope

### In scope

- Construct `VaultIndexer` in `main.ts.onload` with the real `EmbeddingClient`, chunker pipeline (heading + fallback sliding-window), `CanvasChunker` dispatcher for `.canvas` files, `DirtyQueue` persisted under `.leo/index/dirty-queue.json`, `IndexHeader` persisted under `.leo/index/header.json`, `VectorStore` backed by IndexedDB at the `.leo/index/` database name, and a browser idle scheduler (`requestIdleCallback` with `setTimeout` fallback).
- Register Obsidian metadata-cache listeners (`create` / `modify` / `delete` / `rename`) and `metadataCache.on('resolved')` to feed the dirty queue and the `GraphCache`, including header-mismatch prompt on load.
- Build a `GraphCache` and inject it (plus a `TagIndex` derived from chunk tags) into the `RAGEngine`, wired with `Scorer.cosine` + `applyBoosts` and the 1h/2h/tag-shared boost weights.
- Construct the `RAGEngine` with the `VectorStore`, embedding function from the `EmbeddingClient`, exclude-matcher from the `ExcludeListStore`, and tag-matcher utilities; hand it to the `AgentRunner` as the RAG pre-prompt retriever so `search_vault` and in-conversation RAG use the same engine.
- Build an `ExcludeListStore` persisted via `SettingsStore` (or the existing plugin data file), hook it to `RAGEngine` and `VaultIndexer.purgeExcluded`.
- Register the `search_vault` tool on the `ToolRegistry` via `createSearchVaultTool` with the live `RAGEngine`.
- Mount an `IndexerStatusBar` in a dedicated `addStatusBarItem` element subscribed to `VaultIndexer.subscribe`, with rAF-throttled repaints.
- Mount the `IndexEmptyStateCta` React node in the `ChatView` empty-state slot when the vector store reports zero rows.
- Register a `ReindexService` and expose it as a `Leo: Re-index vault` palette command, plus a model-switch confirmation prompt triggered when the embedding model changes in settings.
- Add a settings-tab "Indexing" section containing: index status read-out, re-index button, exclude-list textarea bound to `ExcludeListStore`, and embedding-model chooser with reindex prompt.
- On `onunload`, stop the indexer idle timer, flush the dirty queue and vector store, dispose the graph cache listener, remove status-bar items, and detach all metadata listeners.

### Out of scope

- Performance polish at 10k notes (F50 territory; we ship a working wiring, not a tuned one).
- Per-chunk provenance UI, rank-debug overlay, or query-plan inspector.
- Remote / cloud embedding providers (F61 handles provider adapters; this feature uses whatever the active `EmbeddingClient` resolves to).
- Multi-vault / multi-workspace awareness.

## Acceptance criteria

1. **Entry-point reachability** — after this feature lands, all 17 indexer/RAG/graph orphans listed in `integration-orphans.md` (dated 2026-04-22T18:57) are reachable by import-closure BFS from `src/main.ts`; re-running the §5.4 audit reduces the orphan count by exactly those 17 files.
2. **Indexer construction** — `LeoPlugin.vaultIndexer` is an instance of `VaultIndexer` after `onload`; reading `.leo/index/header.json` round-trips via `IndexHeader`; the first successful chunk embed persists via `VectorStore` and is retrievable by `query`.
3. **Listeners** — `metadataCache.on('resolved')`, vault `create` / `modify` / `delete` / `rename` handlers are attached on load and detached on unload; a synthetic vault event causes the dirty queue to grow.
4. **Idle processing** — chunks drain through `chunkIteration` on `requestIdleCallback` (or its `setTimeout` fallback in test env); unit test stubs the scheduler and verifies work is not done on the hot path.
5. **GraphCache** — after load, `graphCache.neighbors1h(path)` matches `metadataCache.resolvedLinks` for any path with links; a synthetic link add/remove updates the cache incrementally.
6. **RAGEngine query** — calling `ragEngine.query(text)` returns `RAGHit[]` with `{path,line_start,line_end,score}`, respects the exclude list, applies boosts through `Scorer.applyBoosts`, and merges overlapping hits within the same file.
7. **search_vault tool** — `ToolRegistry.toOpenAITools(thread)` includes `search_vault`; invoking it through `AgentRunner` routes to the live `RAGEngine` and returns formatted hits.
8. **IndexerStatusBar** — a status-bar item reads "Indexing X/Y" while draining and is cleared (or shows "Indexed") on empty queue; test verifies subscribe callback fires.
9. **ReindexService command** — `Leo: Re-index vault` appears in the command palette, triggers full reindex via `ReindexService.reindexAll`, and emits a `Notice` on completion.
10. **Empty-state CTA** — on a fresh vault (zero rows in `VectorStore`), the chat empty-state slot renders `IndexEmptyStateCta`; clicking the CTA triggers reindex.
11. **Exclude list** — `SettingsTab > Indexing > Exclude patterns` textarea persists patterns through `ExcludeListStore` and they take effect immediately on the next `RAGEngine.query` and the next `VaultIndexer` drain.
12. **Model-switch prompt** — switching the embedding model in settings opens a confirmation `Notice`/modal; accepting triggers `ReindexService` with the model-switch flag; rejecting leaves the header stale.
13. **onunload cleanup** — after `onunload`, no pending idle callbacks remain, no metadata listeners are attached, and the vector-store connection is closed; a regression test mounts and unmounts and asserts no leaked handles via spy counts.
14. **All existing tests stay green** — 987/987 baseline passes; new tests cover: wiring unit tests for indexer construction, metadata-listener attach/detach, RAGEngine boost pass, search_vault e2e, exclude-list live update, status-bar subscribe, empty-state CTA mount, reindex command + model-switch prompt.

## Dependencies

F27 (indexer) · F28 (chunking) · F29 (embeddings store) · F30 (indexer UI controls) · F31 (RAG cosine) · F32 (exclude list) · F33 (tag filter + search_vault) · F34 (graph cache) · F35 (graph RAG boosts) · F36 (canvas indexing). All already `feature-complete`. This feature only wires them.

## Implementation notes

- [Architecture §4 Runtime data flow — Indexing](../../../../architecture/architecture.md#4-runtime-data-flow) — the indexer chain must match this diagram; wiring order follows §5.1 Plugin Startup.
- [Architecture §5.1 Plugin Startup](../../../../architecture/architecture.md#51-plugin-startup) — `onload` may kick async index sweep in parallel with other adapters; do not block load on full index.
- [Architecture §6 State Ownership](../../../../architecture/architecture.md#6-state-ownership) — pins `.leo/index/header.json`, `.leo/index/dirty-queue.json`, and IndexedDB at `.leo/index` as the vault-side artifacts.
- [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) — `onunload` must flush + close the vector store, dispose graph listener, and clear idle handles.
- [Tech stack — Storage Layout](../../../../standards/tech-stack.md#storage-layout) — storage paths and the IndexedDB name for embeddings.
- [Tech stack — Platform APIs](../../../../standards/tech-stack.md#platform-apis) — `requestIdleCallback` fallback and `Notice` are the required UI affordances for reindex prompts.
- [Code style — Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) — register listeners via `this.registerEvent` so Obsidian auto-cleans on unload.
- [Best practices — Make It Observable](../../../../standards/best-practices.md#core-principles) — emit `indexer.queue.drain`, `rag.query`, `graph.updated` structured logs at the wiring seams.
- Existing compliance-1 notes for F30 / F31 / F32 / F33 / F34 / F35 / F36 explicitly "park" wire-up to main.ts; this feature delivers exactly that.

## Open questions

- Status-bar real estate: one shared "Leo" item with rotating text vs. separate items per subsystem (indexer, provider, breaker)? Default: one item per subsystem with consistent ordering left-to-right.
- Reindex-on-model-switch: `Notice` with inline buttons or a dedicated modal? Default: modal via `SettingsTab`'s wizard helper for consistency.
