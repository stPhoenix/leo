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

## Canvas slice (F23)

Measurements run via `CANVAS_BENCH=verbose pnpm test tests/perf/canvasLayout.bench.test.ts` on 2026-05-05. 5 iterations per preset/size; `p50`/`p95` reported in milliseconds. Fixture: `tests/perf/fixtures/makeCanvasGraph.ts` — hub-and-spoke + chain (deterministic).

| Preset    | 50 nodes p50 (ms) | 50 nodes p95 (ms) | 200 nodes p50 (ms) | 200 nodes p95 (ms) |
|-----------|-------------------|-------------------|--------------------|--------------------|
| bipartite | 0.18              | 4.92              | 0.30               | 1.31               |
| tree      | 0.13              | 0.43              | 0.21               | 0.35               |
| radial    | 0.14              | 0.46              | 0.32               | 0.33               |
| force     | 6.52              | 14.44             | 71.41              | 72.46              |
| grid      | 0.04              | 0.23              | 0.07               | 0.31               |
| timeline  | 0.03              | 0.17              | 0.06               | 0.09               |

Hot path: `force` (Fruchterman-Reingold, seeded). Scales worse-than-linear on edge count due to O(n²) repulsion. 200-node p95 ~72 ms — well below the 500 ms regression bound.

End-to-end `delegate_canvas_create` runtime is dominated by LLM round-trips (refine + extract + reduce) which are mocked in unit tests; measurements above isolate the deterministic LAYING_OUT phase only. Live LLM bench deferred to perf rerun against production providers (`tests/llm/` slice — out of scope for canvas bundle harden).

Allocation profile: not separately measured — `node --cpu-prof` integration with vitest is deferred (matches prior REPORT scope decision).

## Token-budget tuning record (F23)

No deviation from `CANVAS_BUDGETS` constants in `src/agent/canvas/budgets.ts`. SRS §NFR-10 defaults retained:

| Constant            | Value | Notes |
|---------------------|-------|-------|
| `extractorInputCap` | 8000  | chars; ~2k tokens (4-char heuristic) |
| `extractorOutputCap`| 1500  | tokens |
| `reducerInputCap`   | 6000  | chars |
| `reducerOutputCap`  | 2500  | tokens |
| `refineInputCap`    | 4000  | chars |
| `refineOutputCap`   | 1500  | tokens |

Live tuning against Qwen3 30B observed behaviour deferred until first prod canvas runs surface either truncation errors or latency hits. Knob is hot-swappable (single source of truth in `budgets.ts`); no provider-specific overrides shipped.
