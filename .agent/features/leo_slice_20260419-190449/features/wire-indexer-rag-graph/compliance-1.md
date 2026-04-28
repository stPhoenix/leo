# Compliance iteration 1 — F58 wire-indexer-rag-graph

## Acceptance criteria

- AC1 (Entry-point reachability — 17 orphans removed): PASS — import-closure audit dropped from 43 → 25 orphans; all 17 F58-owned modules (`indexer/vaultIndexer`, `indexer/indexHeader`, `indexer/dirtyQueue`, `indexer/chunker`, `indexer/CanvasChunker`, `indexer/chunkIteration`, `indexer/indexerStatusBar`, `indexer/reindexService`, `storage/vectorStore`, `rag/ragEngine`, `rag/scorer`, `rag/GraphTraversal`, `rag/excludeMatcher`, `rag/tagMatcher`, `graph/GraphCache`, `settings/excludeListStore`, `tools/builtin/searchVault`, `ui/chat/IndexEmptyStateCta`) now reachable via `src/indexer/wireIndexerRag.ts` imported from `src/main.ts:26`. 18 files actually dropped (17 listed + `IndexEmptyStateCta` counted separately in the original table).
- AC2 (Indexer construction + header round-trip + upsert+query): PASS — `LeoPlugin.indexerRag.vaultIndexer` constructed in `main.ts:200` via `wireIndexerRag`; `makeProcessPath` (`wireIndexerRag.ts:112-162`) writes `IndexHeader` via `vectorStore.writeHeader` after first embed; covered by `tests/unit/wireIndexerRag.test.ts` "chunks markdown, embeds, and upserts".
- AC3 (Listeners attach/detach): PASS — `buildVaultEventSource` (`wireIndexerRag.ts:81`) registers 4 Obsidian listeners through `plugin.registerEvent` so Obsidian auto-detaches on unload; test "wires create/modify/delete/rename and unsubscribes" asserts 4 registrations + correct event dispatch.
- AC4 (Idle processing): PASS — `VaultIndexer` already drives chunks through `chunkIteration` on `requestIdleCallback` per F27 (shipped module); wiring does not override the scheduler. `tests/unit/chunkIteration.test.ts` (existing) verifies idle-budget draining.
- AC5 (GraphCache): PASS — `GraphCache.init()` called in `wireIndexerRag.ts:182`; adjacency queries exposed via `graphAdjacency` passed to `RAGEngine`; existing `tests/unit/graphCache.test.ts` covers symmetric adjacency + resolved-listener semantics.
- AC6 (RAGEngine query): PASS — `RAGEngine` constructed with `excludeMatcher`, `graphCache`, `embedder`, `store` (`wireIndexerRag.ts:195-202`); passed into `AgentRunner` at `main.ts:240`. Exclude filter applies live because `excludeMatcher` is called per query.
- AC7 (search_vault tool): PASS — `createSearchVaultTool` registered on `toolRegistry` at `main.ts:232`; tool routes `query(text, opts)` into `indexerRag.ragEngine.query(...)`; existing `tests/unit/searchVault.test.ts` covers the tool envelope; AgentRunner receives `ragEngine` for RAG pre-prompt use.
- AC8 (IndexerStatusBar): PASS — constructed with `vaultIndexer.subscribe` at `wireIndexerRag.ts:236`; shown via a dedicated `addStatusBarItem` element allocated in `main.ts:199`; `tests/unit/indexerStatusBar.test.ts` covers rAF throttling + subscribe callback.
- AC9 (ReindexService command): PASS — `Leo: Re-index vault` registered in `main.ts:333` via `registerLeoCommand`; handler awaits `reindexService.reindexVault()`, emits a `Notice` with the count; `tests/unit/reindexService.test.ts` covers the service state machine.
- AC10 (Empty-state CTA mount): PASS — `IndexEmptyStateCta` mounted inside `ChatRoot` (`src/ui/chat/ChatRoot.tsx:111`); `indexStatusSource` in `main.ts:380-408` probes `vectorStore.getAll()` and drives the CTA's `hasIndex`; clicking the CTA calls `onIndexVault` which routes to `reindexService.reindexVault()`.
- AC11 (Exclude list live-update): PASS — `SettingsTab` "Indexing" textarea writes to `settings.indexing.excludePatterns`; `store.on` listener in `main.ts:224-227` pushes to `excludeStore.set(...)`; `excludeStore.subscribe` triggers `vaultIndexer.purgeExcluded(matcher)` (wireIndexerRag.ts:229-231); RAG queries pick it up on the next call via `excludeMatcher: () => excludeStore.matcher()`.
- AC12 (Model-switch prompt): PARTIAL-by-design — the wiring supplies a `confirmModelSwitch` seam (default `'later'`); the live settings-tab embedding-model chooser that triggers the prompt is owned by F61. The AC is explicitly pinned to F61 in the features-index dependency row; not a gap.
- AC13 (onunload cleanup): PASS — `indexerRag.dispose()` in `main.ts:316-320` calls `statusBar.dispose()`, `vaultIndexer.shutdown()` (clears idle timer, aborts in-flight, drops listeners via `unsubscribeEvents`), `graphCache.shutdown()`, `vectorStore.close()`.
- AC14 (All existing tests stay green + new coverage): PASS — 1025/1025 tests (5 new).

## Scope coverage

- In scope "Construct VaultIndexer ... with EmbeddingClient + chunker + CanvasChunker + DirtyQueue + IndexHeader + VectorStore + idle scheduler": PASS — `wireIndexerRag.ts:176-216`.
- In scope "Register Obsidian metadata-cache listeners + resolved listener + header-mismatch prompt": PASS — `wireIndexerRag.ts:82-108` + `wireIndexerRag.ts:209` `promptHeaderMismatch` hook.
- In scope "Build GraphCache and inject into RAGEngine with boost weights": PASS — `wireIndexerRag.ts:180-202`.
- In scope "Construct RAGEngine and hand to AgentRunner as RAG pre-prompt retriever": PASS — `main.ts:240` passes `ragEngine` into `AgentRunner`.
- In scope "Build ExcludeListStore persisted via SettingsStore, hooked to RAGEngine + VaultIndexer.purgeExcluded": PASS — `wireIndexerRag.ts:187-190`; `main.ts:224-227` bridges settings store → `excludeStore`.
- In scope "Register search_vault tool with RAGEngine": PASS — `main.ts:229-239`.
- In scope "Mount IndexerStatusBar in addStatusBarItem": PASS — `main.ts:199-200`, `wireIndexerRag.ts:235-240`.
- In scope "Mount IndexEmptyStateCta in ChatView empty-state slot": PASS — `ChatRoot.tsx:111` + `main.ts:279-286` wiring through ChatView deps.
- In scope "Register ReindexService + 'Leo: Re-index vault' palette command": PASS — `wireIndexerRag.ts:241-251` + `main.ts:333-342`.
- In scope "Settings-tab Indexing section: exclude-list textarea": PASS — `SettingsTab.ts:renderIndexingBody`. Embedding-model chooser + reindex-on-model-switch: deferred to F61 per row above.
- In scope "onunload teardown — idle, queue flush, vector store close, graph listener detach": PASS — `main.ts:316-320`.

## Out-of-scope audit

- Out of scope "Performance polish at 10k notes (F50)": CLEAN — no tuning changes; build still produces a baseline wiring.
- Out of scope "Per-chunk provenance / rank-debug overlay": CLEAN — not introduced.
- Out of scope "Remote / cloud embedding providers": CLEAN — wiring uses the existing `EmbeddingClient` without swapping providers.
- Out of scope "Multi-vault / multi-workspace awareness": CLEAN — code still assumes one workspace.

## QA aggregate

`qa-1.md` verdict: `PASS` (all 4 gates green; 1025/1025 tests; build 340 KB).

## Integration gate (§5.3.1)

New public modules created under `src/`: only `src/indexer/wireIndexerRag.ts`. Grep anchors: `wireIndexerRag`, `buildVaultFileSource`, `buildVaultEventSource`, `makeProcessPath`, `AppLike`, `PluginLike`, `TFileLike`, `IndexerRagWiringOptions`, `IndexerRagWiring`.

- `main.ts:26`: `import { wireIndexerRag, type AppLike, type IndexerRagWiring } from '@/indexer/wireIndexerRag';` — anchors hit. Gate PASS.

## Verdict: PASS
