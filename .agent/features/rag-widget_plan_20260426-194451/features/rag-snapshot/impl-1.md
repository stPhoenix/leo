# Impl iteration 1 — F01 rag-snapshot

## Summary

Shipped a pure, abortable `RagSnapshot` collector and a thin `IndexerStatusTap` adapter that taps the existing `VaultIndexer` `DrainListener` stream and exposes a single `IndexerStatusSnapshot`. The collector reads a small adapter-typed surface (`isAvailable`, `listHeader`, `getAll`) from the vector store, queries graph + exclude stores, and returns a fully-populated snapshot. No UI code was touched in this feature.

## Files touched

- `src/indexer/indexerStatusTap.ts` — new `IndexerStatusTap` class + `IndexerStatusSnapshot` / `IndexerPhase` types; mirrors the `DrainListener` subscription pattern used by `IndexerStatusBar`, but read-only (no DOM).
- `src/rag/ragSnapshot.ts` — new module: `RagSnapshot`, dependency-adapter interfaces (`RagSnapshotVectorStore`, `RagSnapshotGraphCache`, `RagSnapshotExcludeStore`, `RagSnapshotIndexerStatusSource`, `RagSnapshotDeps`), and `createRagSnapshotCollector(deps)` factory returning `{ collect(signal) }`.
- `tests/unit/indexerStatusTap.test.ts` — new test file (8 tests) for the tap state machine.
- `tests/unit/ragSnapshot.test.ts` — new test file (9 tests) for the collector.

## Tests added or updated

- `tests/unit/indexerStatusTap.test.ts` — exercises every drain-event branch (start / tick / complete / error / paused-on-user / dirty), idle initial state, and the dispose unsubscribe contract. Covers AC8, AC9.
- `tests/unit/ragSnapshot.test.ts` — covers the populated-healthy snapshot (AC1, AC6), empty vault (AC1, AC6), unavailable store with explicit reason (AC2), unavailable fallback reason (AC2), drain-in-progress passthrough (AC3), abort-before-getAll (AC4), abort-already-on-entry (AC4), header-missing-but-rows-exist (AC5 boundary), and structured info/warn logging on `getAll` failure (AC7).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- Test file paths: feature.md suggested `tests/unit/rag/ragSnapshot.test.ts`. Existing project layout keeps unit tests flat under `tests/unit/` (e.g. `ragEngine.test.ts`, `vaultIndexer.test.ts`, `indexerStatusBar.test.ts`); the new tests follow that pattern as `tests/unit/ragSnapshot.test.ts` and `tests/unit/indexerStatusTap.test.ts`. Functionally equivalent; matches house style.
- Resolved `OQ-F01-2` ("placement of `IndexerStatusTap`") in favour of `src/indexer/indexerStatusTap.ts` per the feature's default suggestion — tap is an indexer concern, not a RAG concern.
- Resolved `OQ-F01-1` ("derive `filesIndexed` from `getAll()` distinct paths or IDB by-path index walk") in favour of `getAll()` distinct-paths scan for v1, matching the feature's default. Profile-driven optimisation can come later.
- Resolved `OQ-02` ("`approxBytes` accuracy") in favour of computing both `vectorBytesApprox = chunkCount × dim × 4` and a sample-based `textBytesApprox` (≤ 32 rows averaged × `chunkCount`). Keeps the snapshot informative without requiring a full text scan.

## Assumptions

- Indexer "paused-on-user" is detected by matching `error.message.startsWith('Indexer paused')`, which corresponds to the `WAITING_ON_USER_MESSAGE` constant emitted by `VaultIndexer` on header-mismatch user choice `later`. If that exact prefix changes, the tap will fall back to `errored` — acceptable since the message is only surfaced verbatim.
- The collector treats `listHeader()` and `getAll()` failures as recoverable: it logs a `warn` and returns an unavailable-style snapshot with `chunkCount = 0`, instead of throwing. This matches the spec's "no thrown errors escape tools" principle and keeps the UI flow unbroken.
- `RagSnapshotDeps.getStoreUnavailableReason` is optional. Wiring (F03) will pass a function that reads the latest corruption reason captured via `VectorStore.subscribe`. v1 falls back to the literal string `"unavailable"` when no supplier is provided.

## Open questions

None blocking. Future enhancement candidates: surface `lastError` separately for non-paused indexer errors in the widget, expose a per-path chunk distribution.
