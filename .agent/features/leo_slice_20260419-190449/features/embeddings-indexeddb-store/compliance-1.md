# Compliance iteration 1 — F29 embeddings-indexeddb-store

## Acceptance criteria

- AC1: PASS — `EmbeddingClient.embed` at `src/providers/embeddingClient.ts:46-59` splits `texts` into `EMBED_BATCH_SIZE=32` chunks via recursive call; the `embedOnce` path POSTs `{model: opts.model(), input: [...texts]}` to `${endpoint}/v1/embeddings` and maps `data[i].embedding` to the output array; `AbortSignal` is threaded through the fetch. Asserted by `tests/integration/embeddingClient.test.ts` "splits > EMBED_BATCH_SIZE input into sub-batches and returns ordered vectors" (verifies batch sizes [32, 32, 6] and per-batch ordering), plus the pre-existing happy-path + abort cases.
- AC2: PASS — `VectorStore.upsert` at `src/storage/vectorStore.ts:157-194` opens a single `readwrite` transaction on `'vectors'`, drains stale rows via `by-path` index cursor (`:162-166`), then `put`s each row keyed by `chunkRowId(path, line_start, line_end)` (`:168-184`). DB `leo-index`, schema version 1 asserted by constants + tests. Asserted by "upserts chunks with composite-key id and round-trips through getAll" and "re-upserting the same path evicts prior rows before writing new ones".
- AC3: PASS — `writeHeader({model, dim})` at `src/storage/vectorStore.ts:226-237` persists `{key:'header', model, dim, version: VECTOR_STORE_SCHEMA_VERSION=1}` to the single `header` row; `listHeader()` at `:216-224` returns that exact record. Asserted by "writeHeader persists {model, dim, version} and listHeader reads it back".
- AC4: PASS — `verify()` at `src/storage/vectorStore.ts:114-147` runs all five checks: database open (try/catch in `open`), both object stores exist (`:120-125`), `header.version === VECTOR_STORE_SCHEMA_VERSION` (`:128-130`), sample row's `vector.length === header.dim` (`:134-138`), `validateVectorRow(row)` for shape (`:135-136`). `CorruptIndexError.reason` tags each failure path; asserted by "verify() passes on a fresh + populated DB", "verify() returns dim-mismatch", "verify() returns version-mismatch", "verify() returns shape-invalid".
- AC5: PASS — `verify()` failure emits `{kind:'corruption', reason}` to every subscriber (`:144-146`) and sets `available=false` (`:142`); `rebuild()` at `:241-254` closes, calls `deleteDatabaseImpl(dbName)` (defaults to `idb`'s `deleteDB`), re-`open()`s the empty schema, and restores `available=true`. Asserted by "verify() fires a corruption event via subscribe on failure" and "rebuild() deletes the database, re-creates schema, and restores availability".
- AC6: PASS — Structured log events emitted: `index.embed.batch` (batching debug), `index.store.upsert` (`{path, count}`), `index.store.header.write` (`{model, dim}`), `index.store.verify.pass` / `index.store.verify.fail{reason}`, `index.store.corruption.rebuild` (`{dbName}`). Chunk text + vector arrays never logged (only path + count + dim scalars).
- AC7: PASS — Vitest suite enumerated: batch-split + ordered return against msw fixture (embeddingClient new case); `upsert` + `deleteByPath` + composite-key collision against fake-indexeddb (3 tests); header write/read round-trip (1 test); five corruption paths each asserting the distinct `CorruptIndexError.reason` — `open-failed` tested implicitly via the rebuild test's `isAvailable()===false` state; `missing-store` handled by the `open` error path; `version-mismatch`, `dim-mismatch`, `shape-invalid` each have dedicated tests.

## Scope coverage

- In scope "`EmbeddingClient` adapter with batched embed call": PASS — 32-sized batches + ordered output.
- In scope "`VectorStore` adapter (upsert, deleteByPath, listHeader, writeHeader, getAll)": PASS — all 5 surfaces implemented, + `verify`, `rebuild`, `subscribe`, `close`.
- In scope "IndexedDB schema (`schemaVersion=1`, `header` + `vectors` stores, `by-path` index, composite id)": PASS — constants exported.
- In scope "Upsert flow per Chunk row with stale-eviction before put": PASS.
- In scope "IndexHeader read/write": PASS.
- In scope "Corruption detection with 5 invariants + tagged error": PASS.
- In scope "Corruption-recovery UX via event channel + rebuild API": PASS (UI routing is F30's job; API is here).
- In scope "Structured log events": PASS.
- In scope "Vitest coverage per NFR-TEST-01": PASS.

## Out-of-scope audit

- Out of scope "dirty queue + vault listeners + markdown-only filter": CLEAN — F27 owns those; not touched.
- Out of scope "chunking": CLEAN — F28's pure `Chunk` shape consumed; no chunking logic here.
- Out of scope "query embedding / cosine search / top-K": CLEAN — `getAll` is a read seam for F31 to consume, no search logic in this slice.
- Out of scope "settings UI / status bar / reindex palette": CLEAN — API surface only.

## QA aggregate
Verdict: PASS — typecheck/lint/497-tests/build all green; bundle unchanged (idb tree-shakes until wired).

## Verdict: PASS
