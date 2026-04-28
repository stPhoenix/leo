# Outline — arch-alignment plan 20260424-005915

## Phase 1 — Analyze
- [context.md](context.md) — scope, 10 FR, 5 NFR, 6 open questions

## Phase 2 — Slice
- [features-index.md](features-index.md) — 8 features, topologically ordered, 0 UI-needed

## Phase 3 — Detail
- [F01 feature.md](features/zod-tool-schema/feature.md)
- [F02 feature.md](features/tool-ctx-adapters/feature.md)
- [F03 feature.md](features/builtin-tool-layout/feature.md)
- [F04 feature.md](features/langgraph-stategraph/feature.md)
- [F05 feature.md](features/graph-interrupt-confirm/feature.md)
- [F06 feature.md](features/stream-event-union/feature.md)
- [F07 feature.md](features/async-iterable-send/feature.md)
- [F08 feature.md](features/package-metadata-truth/feature.md)

## Phase 4 — Verify
- [verification-1.md](verification-1.md) — PASS (all 8 checks)

## Decisions
- [decisions.md](decisions.md) — all 10 open questions resolved; Q4 gated on bundle bench
- [bench-q4.md](bench-q4.md) — **Q4 GATE FAIL** (+261 KB gz, 6.5× threshold). Counter-proposal: flip F01/F04/F05/F07/F08 to doc-side patches.

## Phase 5 — Remediate
<!-- remediate phase appends refs here (only if verification fails) -->
