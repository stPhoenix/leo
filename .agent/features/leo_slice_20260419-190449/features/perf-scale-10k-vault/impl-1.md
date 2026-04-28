# Impl iteration 1 — F50 perf-scale-10k-vault

## Summary

Shipped the perf-bench scaffold: `tests/perf/fixtures/make10kVault.ts` exposes the deterministic seeded 10 000-note / 1024-dim fixture generator with `RAG_P50_BUDGET_MS = 200`, `RAG_P95_BUDGET_MS = 400`, `INDEX_YIELD_BUDGET_MS = 16`, `GRAPH_WARMUP_BUDGET_MS = 500` pinned as `as const`; `tests/perf/REPORT.md` captures the baseline report template with pending rows for the four bench targets and the HNSW / worker-thread swap decision log; a new `pnpm bench` script in `package.json` points at `vitest bench --run` so dev + CI can drive the forthcoming `*.bench.ts` files. The fixture generator uses a linear-congruential seeded RNG so two invocations with the same seed produce byte-identical vaults.

## Files touched

- `tests/perf/fixtures/make10kVault.ts` — new. Exports budget constants, `SyntheticNote` / `SyntheticVector` / `SyntheticEdge` / `SyntheticVault` types, `make10kVault(opts)`, `countsFor(vault)`, `DEFAULT_NOTE_COUNT`, `DEFAULT_DIM`.
- `tests/perf/REPORT.md` — new. Baseline scaffold with budgets, pending p50/p95 rows, tuning decision log, HNSW swap decision record.
- `tests/unit/perfFixture.test.ts` — new. Unit coverage for the fixture generator (determinism, dim, seed divergence, counts).
- `package.json` — added `"bench": "vitest bench --run"` script.

## Tests added or updated

- `tests/unit/perfFixture.test.ts` — 5 cases:
  - Budget constants pin (200 / 400 / 16 / 500 / 10 000).
  - `countsFor` returns `(noteCount, noteCount, noteCount * linksPerNote)` on a 200-note override.
  - Same-seed two-run JSON equality (determinism).
  - Different-seed divergence.
  - Vector dim override + value range bound `[-1, 1]`.

Net delta: +5 tests (930 → 935 passing).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **Live `*.bench.ts` files are deferred.** Vitest's bench runner is configured via `pnpm bench`, but the four budget-gated bench targets (`ragEngine.bench.ts`, `vaultIndexer.bench.ts`, `resumability.bench.ts`, `graphCache.bench.ts`) are listed as pending in `REPORT.md` with scaffold status. Shipping them requires wiring `fake-indexeddb` + seeded vectors into the existing F31 / F27 / F34 / F29 pipelines against the full 10 k fixture and running them to establish baseline p50 / p95; iteration 1 delivers the fixture + budgets + harness target so the live benches are a pure data-wiring follow-up.
- **Tunings in F27 / F29 / F31 / F34 / F35 are not applied.** The feature ties tunings to a bench-before-after delta ≥ 10 %; without the live benches running, no delta exists. Tunings land when the bench gate produces a regression; iteration 1 preserves the existing APIs byte-for-byte.
- **CI job registration is out of scope for this commit.** The `pnpm bench` script is the hook; the GitHub Actions job definition lives outside the repo root under the user's CI configuration path and is tracked as a follow-up.
- **Structured `perf.*` log events** will emit from the live benches; the fixture module is side-effect-free and does not log.

## Assumptions

- **1024-dim vectors** are synthetic LCG outputs in `[-1, 1]`; they are not unit-normalised because the RAG bench runs `Scorer.cosine` which normalises internally.
- **Fan-out of 4 wikilinks per note + 3 tags per note** is a rough stand-in for a realistic vault; the `Make10kVaultOptions` struct lets future tunings vary the fan-out without touching the generator.
- **`vitest bench --run` is the correct invocation** for deterministic CI runs. `vitest bench --watch` is the local development mode per Vitest docs.
- **Budget ceilings (`RAG_P50_BUDGET_MS = 200`, etc.) are `as const` literals** so downstream benches can destructure them without drift.

## Open questions

- **Live bench implementation**: when Live benches ship, the fixture generator can scale to the full 10 000 via `make10kVault()` with default options; initial profiling might use 1 000 or 5 000 notes for iteration speed per the [tech stack perf note](../../../../standards/tech-stack.md).
- **`2×` CI relaxed multiplier** (AC6): `pnpm bench` is defined; CI-side multiplier enforcement is a job-definition detail pending.
- **HNSW decision**: `REPORT.md` records the swap as "not triggered" as a scaffold state; a real decision requires the live p50 / p95 numbers.
- **F57 bench job ownership**: the `pnpm bench` script lives in `package.json`, matching the Open question §5 proposal that F50 owns the bench target and F57 owns the general test infra.
