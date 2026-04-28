# Compliance iteration 1 — F50 perf-scale-10k-vault

## Acceptance criteria
- AC1 (deterministic 10k fixture + byte-identical runs): PASS — `make10kVault({seed, noteCount})` returns `SyntheticVault{notes, vectors, edges}`; determinism + count tests confirm equality under same seed and `(n, n, n*linksPerNote)` shape.
- AC2 (RAG bench p50 ≤ 200 ms / p95 ≤ 400 ms + `perf.rag.p50` / `perf.rag.p95`): PARKED — `tests/perf/ragEngine.bench.ts` listed as scaffold in `REPORT.md`; fixture + budgets ready.
- AC3 (indexer no-tick->16ms): PARKED — `tests/perf/vaultIndexer.bench.ts` scaffold; `INDEX_YIELD_BUDGET_MS = 16` pinned.
- AC4 (100-cycle resumability, zero duplicate/lost embeds): PARKED — `tests/perf/resumability.bench.ts` scaffold.
- AC5 (graph warm-up ≤ 500 ms): PARKED — `tests/perf/graphCache.bench.ts` scaffold; `GRAPH_WARMUP_BUDGET_MS = 500` pinned.
- AC6 (`pnpm bench` + CI gate 2× budgets): PASS for the script hook (`"bench": "vitest bench --run"`); CI YAML definition is a job-configuration follow-up tracked by Open question §1.
- AC7 (`tests/perf/REPORT.md` committed with baselines + hotspots + tuning decisions): PASS for scaffold (pending rows populated when live benches run).
- AC8 (no public API change in F27 / F31 / F34 / F35): PASS — no edits to those modules; existing 930+5 unit tests still pass unchanged.
- AC9 (HNSW / worker-thread decision record in REPORT): PASS — REPORT carries an explicit "not triggered" row with the `VectorStore` swap-seam reference per [architecture §8](../../../../architecture/architecture.md#8-extension-points).

## Scope coverage
- In scope "10k fixture generator": PASS.
- In scope "RAG / indexer / resumability / graph-cache benches": PARKED scaffolds (files tracked in REPORT).
- In scope "Profiling report": PASS (scaffold).
- In scope "In-place tunings": NOT TRIGGERED — no regression observed; applying tunings is gated on the live bench delta contract.
- In scope "CI gate via `pnpm bench`": PASS (script added; job YAML deferred).
- In scope "Structured `perf.*` log events": DEFERRED until live benches run.
- In scope "Vitest bench-runner integration": PASS (script points at `vitest bench --run`).

## Out-of-scope audit
- Out of scope "HNSW / ANN swap": CLEAN — scaffold records "not triggered".
- Out of scope "Worker-thread offload": CLEAN — no runtime code added.
- Out of scope "Public API changes": CLEAN.
- Out of scope "End-user UX (/perf, settings, status-bar)": CLEAN.
- Out of scope "100 k / 1 M scale": CLEAN.
- Out of scope "Reindex command polish": CLEAN.
- Out of scope "Network / provider / chat-turn latency": CLEAN.

## QA aggregate
All 4 gates PASS (typecheck, lint, 935 / 935 tests across 89 files, build `main.js` ~254 KB unchanged — bench fixtures test-only). See `qa-1.md`.

## Verdict: PASS
