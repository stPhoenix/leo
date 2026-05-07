# F23 · canvas-bundle-perf-harden — Bundle + perf hardening

## Purpose

Wire the bundle-size assertion (≤ 60 KB delta vs baseline) and the perf REPORT entry for canvas runs against 50- and 200-node fixtures. Tune token budgets against Qwen3 30B observed behavior; expand layout golden-file fixtures. Final-phase quality gate before public release.

Covers [NFR-CANVAS-04](../../context.md#non-functional-requirements).

## Scope

**In scope**

- Update `.agent/budgets/bundle-baseline.json` post-canvas-merge to capture the new baseline; `pnpm check:bundle` enforces ≤ 60 KB delta on subsequent commits.
- `tests/perf/fixtures/makeCanvas50Vault.ts` + `makeCanvas200Vault.ts` — synthetic vaults of 50 / 200 entities for benchmark.
- Bench scenarios: `delegate_canvas_create` end-to-end (mock LLM); LAYING_OUT-only with each preset on 50 / 200 nodes.
- Update `tests/perf/REPORT.md` with canvas measurements (median + p95 latency, allocations).
- Token-budget tuning record: any deviation from SRS §NFR-10 defaults logged in `tests/perf/REPORT.md` with rationale + run timestamp.
- Golden-file expansion: per-preset fixtures for edge cases (single-node, two disconnected components, all-locked re-run).

**Out of scope**

- Implementation feature work — owned by F01..F22.
- Settings UI — out of v1 (SRS §10).

## Acceptance criteria

1. `pnpm check:bundle` passes with the post-canvas baseline; subsequent edits exceeding 60 KB delta fail CI — traces to NFR-CANVAS-04.
2. 50-node `delegate_canvas_create` median runtime + p95 + allocations recorded in `tests/perf/REPORT.md`.
3. 200-node `delegate_canvas_create` recorded.
4. Per-preset golden-file fixtures exist under `tests/unit/canvas/fixtures/<preset>/` with at least 3 graph shapes each (small connected, disconnected, hub-and-spoke).
5. Any token-budget tuning vs SRS §NFR-10 defaults documented (or absence noted) in REPORT.

## Dependencies

- [../canvas-slash-commands/feature.md](../canvas-slash-commands/feature.md) — full canvas surface implemented before bench is meaningful.
- Requirements traced: [../../context.md#non-functional-requirements](../../context.md#non-functional-requirements) NFR-CANVAS-04.

## Implementation notes

- [../../../../architecture/architecture.md#1-architectural-principles](../../../../architecture/architecture.md#1-architectural-principles) — bundle-size principle.
- [../../../../standards/best-practices.md#testing--quality-gates](../../../../standards/best-practices.md#testing--quality-gates) — perf measurement methodology.
- [../../../../standards/best-practices.md#operational-excellence](../../../../standards/best-practices.md#operational-excellence) — observability + measurement.

## Open questions

- 60 KB cap comfortably allows hand-rolled algorithms; if ELK or `dagre` are added later (post-v1 §14), what's the new budget? Defer to that change; bundle baseline is updated per-feature merge per existing convention.
