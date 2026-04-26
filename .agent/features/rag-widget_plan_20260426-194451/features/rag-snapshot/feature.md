# F01 · rag-snapshot — RAG snapshot collector

## Purpose

Provide a pure, abortable collector that reads the current state of the RAG / index subsystem and returns a typed `RagSnapshot` payload consumed by F02 (`rag` widget). It is the single source of truth for the data the widget renders, isolating UI from `VectorStore`, `VaultIndexer`, `GraphCache`, and `ExcludeListStore` access. Covers [FR-03](../../context.md#functional-requirements), [FR-04](../../context.md#functional-requirements), [FR-06](../../context.md#functional-requirements), [FR-07](../../context.md#functional-requirements), [NFR-01](../../context.md#non-functional-requirements), [NFR-02](../../context.md#non-functional-requirements), [NFR-03](../../context.md#non-functional-requirements), [NFR-08](../../context.md#non-functional-requirements).

## Scope

In scope:

- A new module `src/rag/ragSnapshot.ts` exporting:
  - `RagSnapshot` interface — fields: `filesIndexed`, `chunkCount`, `model`, `dim`, `storeAvailable`, `storeUnavailableReason` (when applicable), `indexerStatus` (`{ phase, remaining, currentPath?, lastError? }`), `excludePatternCount`, `graphNodeCount`, `vectorBytesApprox`, `textBytesApprox?`.
  - `RagSnapshotDeps` interface — dependency-injected readers: `getVectorStore()`, `subscribeIndexer(listener)` / `latestDrainState()` adapter, `getGraphCache()`, `getExcludeStore()`, `getEmbeddingModel()`, `logger?`.
  - `createRagSnapshotCollector(deps)` factory returning `{ collect(signal: AbortSignal): Promise<RagSnapshot> }` mirroring the `createContextCommand` abortable shape.
- A thin `IndexerStatusTap` helper (in the same module or `src/indexer/indexerStatusTap.ts`) that mirrors the `DrainListener` pattern used by `IndexerStatusBar` to keep a `latest` snapshot of `{ phase, remaining, currentPath, lastError }`. Reused by the collector and not coupled to UI.
- Unit tests under `tests/unit/rag/ragSnapshot.test.ts` covering: idle populated, indexing in progress, unavailable store, empty vault, abort propagation, header-missing case (no header row yet but rows exist).

Out of scope:

- The widget component / rendering (F02).
- Slash command registration / palette wiring (F03).
- Live refresh subscription on the widget side; the collector simply returns a snapshot per call. F03 may invoke it more than once.
- IDB schema changes; the collector reads what is already stored.

## Acceptance criteria

1. `createRagSnapshotCollector(deps).collect(signal)` returns a fully populated `RagSnapshot` for a healthy store, idle indexer ([FR-03](../../context.md#functional-requirements), [FR-06](../../context.md#functional-requirements)).
2. When `store.isAvailable() === false` or `open()`/`verify()` failed, the snapshot has `storeAvailable: false`, `storeUnavailableReason` populated from the last `CorruptionReason`, and `chunkCount`/`filesIndexed` set to `0` ([FR-05 boundary contract w/ F02](../../context.md#functional-requirements)).
3. When the indexer is currently draining, `indexerStatus.phase === 'draining'`, `remaining` matches the latest `tick.remaining`, and `currentPath` is the path from the most recent `tick` event ([FR-07](../../context.md#functional-requirements)).
4. `collect(signal)` honours abort: aborting the signal during `store.getAll()` rejects the returned promise with the signal's reason and does not log at `error` ([NFR-01](../../context.md#non-functional-requirements)). Re-issuing `collect` cancels prior in-flight calls when wired through F03's command handle.
5. `vectorBytesApprox` is computed as `chunkCount × (dim ?? 0) × 4`. `textBytesApprox` is optional; if implemented, it is derived from a sample of ≤ 32 rows averaged and multiplied by `chunkCount`, otherwise omitted ([OQ-02](../../context.md#open-questions)).
6. `excludePatternCount` is the count returned by the exclude store API; `graphNodeCount` is `graphCache.size()`. Both default to `0` when their stores are not initialised ([FR-03](../../context.md#functional-requirements)).
7. The collector logs `info` on entry and exit and `warn` on collection failures; `console.log` is forbidden ([NFR-08](../../context.md#non-functional-requirements)).
8. The module imports zero React, zero Obsidian, and zero IndexedDB types directly — only the typed adapter interfaces — so it can be unit-tested with simple fakes ([NFR-02](../../context.md#non-functional-requirements), [NFR-03](../../context.md#non-functional-requirements)).
9. The `IndexerStatusTap` adapter unsubscribes via the same disposer contract as `IndexerStatusBar`; double-dispose is a no-op.
10. All exports are named (no defaults) and use `as const` literal unions for `phase` ([code-style.md TypeScript rule](../../../../standards/code-style.md#typescript)).

## Dependencies

- Depends on context: [scope](../../context.md#scope), [FR-03](../../context.md#functional-requirements), [FR-04](../../context.md#functional-requirements), [FR-06](../../context.md#functional-requirements), [FR-07](../../context.md#functional-requirements), [NFR-01](../../context.md#non-functional-requirements), [NFR-02](../../context.md#non-functional-requirements), [NFR-08](../../context.md#non-functional-requirements).
- No upstream feature deps.

## Implementation notes

- Place the module under `src/rag/` to sit alongside `ragEngine.ts` per [§3.3 Domain / Core](../../../../architecture/architecture.md#33-domain--core-pure) — pure logic, no platform imports.
- Reuse the existing `DrainEvent`/`DrainListener` shapes from `vaultIndexer.ts` referenced from [§5.4 Lazy Indexing](../../../../architecture/architecture.md#54-lazy-indexing); do not introduce a new event bus per [NFR-02](../../context.md#non-functional-requirements).
- Read store header via `VectorStore.listHeader()` and chunk rows via `VectorStore.getAll()`; consult [tech-stack.md storage layout](../../../../standards/tech-stack.md#storage-layout) for IDB layout context — vectors live in IndexedDB, not the vault filesystem.
- Follow the abortable command pattern already in use by `createContextCommand` (referenced from [§4 Key Contracts](../../../../architecture/architecture.md#4-key-contracts)) — same `Promise` + `AbortSignal` ergonomics; F03 will wrap this collector inside its own handle.
- Use the project [logging contract](../../../../standards/code-style.md#logging) — structured key/value via `Logger`, no PII, no `console.log`.
- Tests follow [Vitest conventions](../../../../standards/code-style.md#testing-vitest--msw) — fakes for the small adapter interfaces, no real IDB.

## Open questions

- **OQ-F01-1** — Should `filesIndexed` be derived from `getAll()` distinct paths or a cheaper IDB index walk via the existing `by-path` index? Acceptable for v1 to scan; mark as a follow-up if profiling indicates it is too costly on > 5k chunks.
- **OQ-F01-2** — Does `IndexerStatusTap` belong in `src/rag/` or `src/indexer/`? Default placement: `src/indexer/indexerStatusTap.ts` (it taps an indexer concern); F02/F03 import via the snapshot's adapter interface so location is internal.
