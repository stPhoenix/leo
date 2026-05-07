# Impl iteration 1 — F23 canvas-bundle-perf-harden

## Summary

Bundle baseline rebased to 2,431,024 B (post-canvas-merge) with `maxDeltaBytes` set to 60 KB per NFR-CANVAS-04. `pnpm check:bundle` passes. Synthetic 50/200-node graph fixture + bench-as-test capture p50/p95 timing for every preset. REPORT.md gains a Canvas slice section + token-budget tuning record. Per-preset golden-shape coverage (`small connected / two components / hub-and-spoke`) plus an all-locked re-run preservation test added.

## Files

- `.agent/budgets/bundle-baseline.json` — `baselineBytes: 2431024`, `maxDeltaBytes: 61440`, comment documents canvas-slice merge baseline reset.
- `tests/perf/fixtures/makeCanvasGraph.ts` — deterministic hub-and-spoke + chain `EntityGraph` factory.
- `tests/perf/canvasLayout.bench.test.ts` — bench-as-test capturing p50/p95 per preset×size; emits structured `canvas.bench …` lines under `CANVAS_BENCH=verbose`. 12 tests, asserts O(n²)-regression bound (1500ms p95).
- `tests/perf/REPORT.md` — added Canvas slice section with measurement table + token-budget tuning record (no deviations from `CANVAS_BUDGETS` defaults).
- `tests/unit/canvas/fixtures/layoutShapes.ts` — `SMALL_CONNECTED`, `TWO_COMPONENTS`, `HUB_AND_SPOKE` golden-shape `EntityGraph`s.
- `tests/unit/canvas/layoutGoldenShapes.test.ts` — 24 tests cover every preset × every shape (24 = 6 presets × 3 shapes + 6 all-locked re-run preservation × 1).

## Decisions

- **60 KB cap chosen** per F23 NFR; leaves headroom for follow-up tuning slices without forcing rebaseline on every commit.
- **Bench as test, not bench runner** — `vitest bench` integration deferred (matches prior REPORT scope decision); 5-iteration timed test gives p50/p95 reproducibly. Verbose mode (`CANVAS_BENCH=verbose`) prints structured lines for REPORT regeneration.
- **`force` p95 bound = 1500ms** — first-iteration cold start hits ~700ms on noisy CI runners; steady-state hot p95 is <80ms per REPORT. Tighter bound caused flake.
- **End-to-end `delegate_canvas_create` bench deferred** — runtime is dominated by LLM round-trips which are mocked in unit tests; live LLM bench belongs to `tests/llm/` slice.
- **Token-budget tuning: no deviations** — SRS §NFR-10 defaults retained pending live prod canvas runs.

## Test coverage

37 new tests (12 perf bench + 24 golden + 1 reload of all-locked preservation). All green.

## QA local

Typecheck/lint/test/build/check:bundle all green (290 files / 2730 tests; +5 files +37 tests vs F22).
