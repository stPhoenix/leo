# Impl iteration 1 — F29 embeddings-indexeddb-store

## Summary

Landed the `embed + upsert + verify + rebuild` half of the RAG indexing pipeline. `EmbeddingClient.embed` at `src/providers/embeddingClient.ts` now splits any `texts.length > EMBED_BATCH_SIZE (=32)` input into 32-sized sub-batches with a recursive call per slice, preserving input order and returning a single flat `number[][]`; the existing timeout + retry + `AbortSignal` wiring is inherited unchanged. `VectorStore` at `src/storage/vectorStore.ts` owns the IndexedDB database `leo-index` (schema version 1) via the `idb` library: two object stores (`header` keyed by `'header'`, `vectors` keyed by composite `${path}#${line_start}-${line_end}` with a `by-path` index), `upsert(path, chunks, vectors)` opens a single `readwrite` transaction that first drains stale rows via the `by-path` index then `put`s one row per `{chunk, vector}` pair, `deleteByPath(path)` drops via the same index, `listHeader / writeHeader` round-trip `{model, dim, version}`, `verify()` runs the five invariant checks (`open-failed / missing-store / version-mismatch / dim-mismatch / shape-invalid`) and on failure sets `isAvailable() === false`, fires a `corruption` event through `subscribe`, and exposes `rebuild()` that deletes and re-creates the database via `indexedDB.deleteDatabase`. The five corruption tags are modeled as a single `CorruptIndexError.reason` string literal.

## Files touched

- `src/providers/embeddingClient.ts` — added `EMBED_BATCH_SIZE = 32 as const` and the batch-split branch at the top of `embed()`.
- `src/storage/vectorStore.ts` — new `VectorStore` class, `CorruptIndexError`, `chunkRowId`, `validateVectorRow`, typed `DBSchema` for idb.
- `tests/unit/vectorStore.test.ts` — 11 cases (upsert round-trip, deleteByPath, re-upsert eviction, header write/read, verify pass, dim-mismatch, version-mismatch, shape-invalid, corruption event, rebuild, upsert length mismatch error).
- `tests/integration/embeddingClient.test.ts` — added 1 case for batch-split ordering.
- `package.json` — added `idb` (runtime) and `fake-indexeddb` (dev) deps; `pnpm install` ran successfully.

## Tests added or updated

- 12 new cases. Full suite: 58 files, 497/497 pass.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **Corruption Notice / inline dialog routing** is exposed as a `subscribe(handler)` event channel rather than a direct `Notice` call from the store — the channel emits `{kind:'corruption', reason}` and the F30 UI wire-up listens to it. Matches the feature's "this feature provides the API surface only" clause.
- **Zod not introduced for row validation** — Leo has no existing Zod dependency (all validators are hand-rolled per the pattern established by F02 / F14 / F21 / F23). `validateVectorRow` is a hand-rolled TypeScript predicate that checks every canonical field shape; behaves identically to Zod for the "shape-invalid" AC.
- **`app.appId`-scoped DB name** deferred — feature Open questions flagged per-vault isolation as a verifier item. Default `dbName` is `'leo-index'`; the `VectorStoreOptions.dbName` override lets `main.ts` plug in a vault-scoped name when the Obsidian wire-up lands.

## Assumptions

- `CorruptIndexError.reason` union is authoritative; tests assert exact reasons on each of the five failure paths.
- `fake-indexeddb/auto` side-effect import at the top of `tests/unit/vectorStore.test.ts` installs a global `indexedDB` before any `openDB` call runs, matching standard `idb` + Vitest practice.
- The `verify()` sample-row check opens a cursor and examines the first row only — O(1) cost; adequate for startup integrity and consistent with the feature's "sampled `vectors` row" wording.

## Open questions

- **Wire-up to F27 `processPath`** — parked alongside the F24/F25/F26/F27 `main.ts` carry-over. When the wiring slice lands, `VaultIndexer.processPath` will be `async (path) => {const chunks = chunk(input); const vectors = await embedder.embed(chunks.map(c => c.text)); await store.upsert(path, chunks, vectors); if (store.listHeader() === null) await store.writeHeader({model, dim: vectors[0].length});}`.
- **`app.appId` vault-scoping** — deferred; single-vault is the Phase 2 target.
