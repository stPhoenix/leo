# F50 perf baseline report

Status: **scaffold** — fixture generator and budget constants shipped; live bench runs pending a dedicated `vitest bench` configuration.

## Budgets

| Scope | Constant | Value (ms) |
|---|---|---|
| RAG p50 ([NFR-PERF-03](../../.agent/features/leo_slice_20260419-190449/context.md#nfr-perf-03)) | `RAG_P50_BUDGET_MS` | 200 |
| RAG p95 | `RAG_P95_BUDGET_MS` | 400 |
| Indexer tick ceiling ([NFR-PERF-02](../../.agent/features/leo_slice_20260419-190449/context.md#nfr-perf-02)) | `INDEX_YIELD_BUDGET_MS` | 16 |
| Graph warm-up ([NFR-PERF-02](../../.agent/features/leo_slice_20260419-190449/context.md#nfr-perf-02)) | `GRAPH_WARMUP_BUDGET_MS` | 500 |
| CI relaxed multiplier | — | 2× nominal |

## Baseline p50 / p95 (pending)

| Bench | p50 (ms) | p95 (ms) | Status |
|---|---|---|---|
| RAG (`tests/perf/ragEngine.bench.ts`) | — | — | scaffold |
| Indexer (`tests/perf/vaultIndexer.bench.ts`) | — | — | scaffold |
| Resumability (`tests/perf/resumability.bench.ts`) | — | — | scaffold |
| Graph warm-up (`tests/perf/graphCache.bench.ts`) | — | — | scaffold |

## Top-5 hotspots (pending)

To be regenerated from `node --cpu-prof` once the bench runner lands.

## Tuning decision log

| Candidate | Delta % | Decision |
|---|---|---|
| `DEFAULT_TOP_K` heap allocation avoidance in F31 | — | deferred |
| Batched `VectorStore.getAll()` streaming | — | deferred |
| `requestIdleCallback` yield cadence in F27 | — | deferred |
| Embedding batch size in F29 | — | deferred |
| Graph-cache warm-up ordering relative to `VaultIndexer.init()` | — | deferred |

## HNSW / worker-thread swap decision

Not triggered — the 10 k-row linear-scan path is documented as meeting budget in the
[F31](../../.agent/features/leo_slice_20260419-190449/features/rag-cosine-search/feature.md) single-run bench; live p50 / p95 distributions will confirm. The swap seam is reserved at `VectorStore` per [architecture §8](../../.agent/features/leo_slice_20260419-190449/architecture/architecture.md#8-extension-points) if a later run regresses.

## Regeneration cadence

Regenerated on every bench-budget-breach regression-fix PR.
