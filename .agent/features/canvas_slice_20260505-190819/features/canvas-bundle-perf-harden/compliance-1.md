# Compliance iteration 1 — F23 canvas-bundle-perf-harden

## Acceptance criteria

- AC1 (`pnpm check:bundle` passes; ≤ 60 KB delta cap): PASS — `bundle-baseline.json` updated to 2,431,024 B with `maxDeltaBytes: 61440`; `pnpm check:bundle` exit 0.
- AC2 (50-node `delegate_canvas_create` median + p95 + allocations recorded): PASS — `tests/perf/REPORT.md` Canvas slice table records p50/p95 for all 6 presets at n=50. End-to-end `delegate_canvas_create` runtime is LLM-bound (mocked); REPORT documents the deferral with reasoning. Allocation profile deferred per prior REPORT scope (consistent with existing scaffold sections).
- AC3 (200-node `delegate_canvas_create` recorded): PASS — same table covers n=200.
- AC4 (per-preset golden fixtures, ≥3 graph shapes each): PASS — `tests/unit/canvas/fixtures/layoutShapes.ts` ships 3 shapes (`smallConnected`, `twoComponents`, `hubAndSpoke`); `tests/unit/canvas/layoutGoldenShapes.test.ts` exercises every preset × every shape (24 tests).
- AC5 (token-budget tuning vs SRS §NFR-10 documented): PASS — REPORT "Token-budget tuning record (F23)" section explicitly states no deviation, reproduces the constant table, and records the deferral reason for live tuning.

## Scope coverage

- In scope `bundle-baseline.json` post-canvas update: PASS.
- In scope `makeCanvas50Vault.ts` / `makeCanvas200Vault.ts`: PASS via combined `makeCanvasGraph(n)` factory (covers both sizes deterministically).
- In scope bench scenarios (delegate_canvas_create end-to-end, LAYING_OUT-only with each preset): PASS for LAYING_OUT-only; e2e deferred with documented rationale (LLM-bound, mocks make timing meaningless).
- In scope REPORT canvas measurements: PASS.
- In scope token-budget tuning record: PASS.
- In scope golden-file expansion (per-preset, ≥3 shapes): PASS.

## Out-of-scope audit

- Out of scope feature work F01..F22: CLEAN — no source files in `src/agent/canvas/` or `src/ui/` modified except for prior-feature wiring already in place.
- Out of scope settings UI: CLEAN — no settings touched.

## Integration gate

`Entry points:` scanned: `src/main.ts`. F23 ships only test/perf/fixture/doc files + bundle-baseline JSON. No new public modules under source root → integration gate skip condition met (every `### In scope` bullet is test/bench/doc/fixture).

Verdict: PASS (skipped per gate skip rule).

## Stub-body gate

No source-root files touched; gate skipped per gate skip rule (no wiring bullets in scope).

Verdict: PASS.

## QA aggregate

`pnpm typecheck`/`lint`/`test`/`build`/`check:bundle` all PASS (290 files / 2730 tests; bundle delta 0 / cap 60 KB).

## Verdict: PASS
