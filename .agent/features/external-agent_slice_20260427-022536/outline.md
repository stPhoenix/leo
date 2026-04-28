# Outline — external-agent slice 20260427-022536

## Phase 1 — Analyze
- [context.md](context.md) — 34 FR-EXT, 8 NFR-EXT, 9 constraints, glossary, 8 open questions

## Phase 2 — Slice
- [features-index.md](features-index.md) — 13 features (F01–F13), 2 UI features, full forward coverage table

## Phase 3 — Detail

Scope revision (mid-phase, per user direction): F09 (`adapter-claude-code`) and F10 (`adapter-openai-compatible`) removed. Concrete adapters deferred from v1; FR-EXT-32 marked deferred in [`context.md`](context.md) and [`features-index.md`](features-index.md). Architecture-compliance audit applied — see notes in F02, F03, F04 implementation-notes sections.

- [features/adapter-contract/feature.md](features/adapter-contract/feature.md) — F01 contract + registry + ESLint isolation rule
- [features/result-writer/feature.md](features/result-writer/feature.md) — F02 vault writer + RAG exclude wiring (Adapter-layer despite location under `src/agent/externalAgent/`)
- [features/subgraph-state-machine/feature.md](features/subgraph-state-machine/feature.md) — F03 typed state + LangGraph skeleton + per-thread slot manager
- [features/refine-sub-agent/feature.md](features/refine-sub-agent/feature.md) — F04 refine LLM loop + clarifying interrupts + budget enforcement
- [features/run-phase/feature.md](features/run-phase/feature.md) — F05 adapter execution, timeout, write/error transitions, structured tool result
- [features/delegate-external-tool/feature.md](features/delegate-external-tool/feature.md) — F06 trigger tool with custom Prepare/Deny confirmation
- [features/widget-controller/feature.md](features/widget-controller/feature.md) — F07 subgraph ↔ widget bridge with reload-rehydration
- [features/widget-ui/feature.md](features/widget-ui/feature.md) — F08 inline widget block + per-phase Storybook stories
- [features/settings-ui/feature.md](features/settings-ui/feature.md) — F11 settings section + per-adapter config + empty-registry state + Storybook
- [features/history-persistence/feature.md](features/history-persistence/feature.md) — F12 persisted block kind, terminal-state snapshot, reload flush
- [features/logging-bundle/feature.md](features/logging-bundle/feature.md) — F13 namespace, payload-gating lint, bundle-size CI check

## Phase 4 — UI

Per Constraint **C-06** ("don't forget storybooks") all UI features carry an explicit Storybook story matrix.

- [features/widget-ui/ui.md](features/widget-ui/ui.md) — F08 layouts (7 phases), state machine, event flow, 14-story matrix
- [features/settings-ui/ui.md](features/settings-ui/ui.md) — F11 layouts (4 variants), state machine, event flow, 6-story matrix incl. mandatory `NoAdaptersRegistered` v1 fixture

## Phase 4 — Verify
- [verification-1.md](verification-1.md) — FAIL on Check 7 (two Implementation-notes bullets > 60 words)
- [verification-2.md](verification-2.md) — PASS, all 8 checks

## Phase 5 — Remediate
- [remediation-1.md](remediation-1.md) — Tightened F03 + F04 Implementation-notes bullets; relocated cross-feature reasoning into features-index.md §"Architecture compliance summary"
