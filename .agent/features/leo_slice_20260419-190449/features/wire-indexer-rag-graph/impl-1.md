# Impl iteration 1 — F58 wire-indexer-rag-graph

## Summary

Added `src/indexer/wireIndexerRag.ts` wiring helper that constructs `VectorStore`, `GraphCache`, `ExcludeListStore`, `RAGEngine`, `VaultIndexer` (with `processPath` chunking + embedding + upsert pipeline for markdown and canvas), `IndexerStatusBar`, and `ReindexService`. Wired the full stack into `main.ts` `onload`/`onunload`, registered the `search_vault` tool, added the `Leo: Re-index vault` palette command, mounted `IndexEmptyStateCta` through `ChatRoot`, and added an "Indexing" section to `SettingsTab` with an exclude-patterns textarea. Settings changes push into `ExcludeListStore`, which purges queued excluded paths and takes effect immediately on the next RAG query. Added 5 wiring unit tests. 1025/1025 tests pass; build ~340 KB.

## Files touched

- `src/indexer/wireIndexerRag.ts` — new wiring helper: `AppLike`, `PluginLike`, `buildVaultFileSource`, `buildVaultEventSource`, `makeProcessPath`, `wireIndexerRag`.
- `src/main.ts` — constructs `indexerRag` via `wireIndexerRag`, registers `search_vault` tool, passes `ragEngine` to `AgentRunner`, adds status bar item, adds re-index command, wires `IndexEmptyStateCta` source into `ChatView`, subscribes settings → `ExcludeListStore`, disposes on unload.
- `src/settings/settingsStore.ts` — new `IndexingSettings { excludePatterns: string[] }` with migration + defaults.
- `src/settings/SettingsTab.ts` — new `renderIndexingBody` with textarea bound to `settings.indexing.excludePatterns`.
- `src/ui/chat/ChatRoot.tsx` — props `indexStatusSource`, `indexDrainSubscribe`, `onIndexVault`; mounts `IndexEmptyStateCta` between `ContextIndicator` and `MessageList`.
- `src/ui/chatView.tsx` — `ChatViewDeps` extended with the three index-status props; threaded through to `ChatRoot`.

## Tests added or updated

- `tests/unit/wireIndexerRag.test.ts` — 5 new tests covering:
  - `buildVaultFileSource` filters to `md` + `canvas` (AC1, AC5).
  - `buildVaultEventSource` registers 4 Obsidian listeners, dispatches `create/modify/rename` to the handler (AC3).
  - `makeProcessPath` chunks a markdown file, embeds, and upserts; writes index header with correct dim (AC2).
  - `makeProcessPath` deletes when the file is missing (AC3/AC6 purge-on-delete).
  - `makeProcessPath` routes `.canvas` through `CanvasChunker` and upserts per-node chunks (AC6 canvas path).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- The "model-switch confirmation prompt" (AC12) currently defaults `confirmModelSwitch` to `'later'` — a functional no-op — because the settings-tab embedding-model chooser is wired in F61 (`wire-cloud-providers`). The wiring hook is in place; F61 extends it.
- `IndexEmptyStateCta` is mounted into the `ChatRoot` above `MessageList` rather than inside the `MessageList` empty-state `<div>`. This keeps the CTA visible when the vault has no index regardless of whether the chat has messages; it matches the intent of AC10 (CTA visible when the vector store reports zero rows).
- The index header `dim` is set opportunistically to the first embedded vector's length (inside `makeProcessPath`), not to `spec().dim` before indexing. Rationale: the embedding model may vary by provider and the authoritative dim only becomes known after the first successful embed.

## Assumptions

- Obsidian's `vault.on('create'|'modify'|'delete'|'rename', cb)` and `metadataCache.on('resolved', cb)` return `EventRef` values compatible with `plugin.registerEvent(ref)` for auto-cleanup on unload.
- `vault.cachedRead(file)` is safe for indexing pipeline (does not mutate file state).
- IndexedDB is available in Obsidian's renderer process (it is — all platforms support it).
- `ExcludeListStore.set(patterns)` being called synchronously after `SettingsStore.on` callback is safe (the store is thread-safe within a single JS runtime).

## Open questions

- Should the status-bar item show "Indexed N chunks" at steady state, or remain hidden? Current behaviour hides it on `complete` per F30's `IndexerStatusBar` design. Revisit in F67 when `NotificationsHub` centralizes status surfaces.
- Whether to run `vaultIndexer.processDueWork()` on `workspace.onLayoutReady` vs. leaving the dirty-queue to drain lazily: current wiring depends on the idle scheduler's first tick. Layout-ready kickoff could be added if startup indexing feels too slow on cold vaults.
