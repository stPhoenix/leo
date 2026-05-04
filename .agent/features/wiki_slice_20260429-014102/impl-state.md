# Impl state — wiki_slice_20260429-014102

Started: 2026-04-29T02:15:50+03:00
Input mode: workspace
Project root: /home/bs/PycharmProjects/leo
Entry points:
- src/main.ts

| # | Feature id | Slug | Iter | Phase | Status | Note | Artifacts |
|---|------------|------|------|-------|--------|------|-----------|
| 1 | F01 | wiki-bootstrap | 1 | impl | done | seed modules + bootstrap.ts + dirtyQueue wiki/ filter + main.ts wiring | features/wiki-bootstrap/impl-1.md |
| 2 | F01 | wiki-bootstrap | 1 | qa | done | typecheck/lint/tests/build all PASS | features/wiki-bootstrap/qa-1.md |
| 3 | F01 | wiki-bootstrap | 1 | compliance | done | PASS — all ACs satisfied; no stubs; no scope leaks | features/wiki-bootstrap/compliance-1.md |
| 4 | F01 | wiki-bootstrap | 1 | feature-complete | done | shipped | — |
| 5 | F02 | wiki-search-basics | 1 | impl | done | search_wiki tool + indexReader + LEO_PREAMBLE routing | features/wiki-search-basics/impl-1.md |
| 6 | F02 | wiki-search-basics | 1 | qa | done | typecheck/lint/2100 tests/build PASS | features/wiki-search-basics/qa-1.md |
| 7 | F02 | wiki-search-basics | 1 | compliance | done | PASS — all ACs satisfied; no scope leaks | features/wiki-search-basics/compliance-1.md |
| 8 | F02 | wiki-search-basics | 1 | feature-complete | done | shipped | — |
| 9 | F03 | wiki-status-slash | 1 | impl | done | collector + slash + widget + storybook | features/wiki-status-slash/impl-1.md |
| 10 | F03 | wiki-status-slash | 1 | qa | done | typecheck/lint/2111 tests/build PASS | features/wiki-status-slash/qa-1.md |
| 11 | F03 | wiki-status-slash | 1 | compliance | done | PASS — all ACs satisfied; mutex stays idle until F05 wires | features/wiki-status-slash/compliance-1.md |
| 12 | F03 | wiki-status-slash | 1 | feature-complete | done | shipped | — |
| 13 | F04 | wiki-runtime-utils | 1 | impl | done | budgets + loggingNamespaces + runId + liveControllerRegistry | features/wiki-runtime-utils/impl-1.md |
| 14 | F04 | wiki-runtime-utils | 1 | qa | done | typecheck/lint/2126 tests/build PASS | features/wiki-runtime-utils/qa-1.md |
| 15 | F04 | wiki-runtime-utils | 1 | compliance | done | PASS — utility scaffolding clean | features/wiki-runtime-utils/compliance-1.md |
| 16 | F04 | wiki-runtime-utils | 1 | feature-complete | done | shipped | — |
| 17 | F05 | wiki-mutex | 1 | impl | done | WikiMutex + withWikiMutex helper, wired in main | features/wiki-mutex/impl-1.md |
| 18 | F05 | wiki-mutex | 1 | qa | done | typecheck/lint/2132 tests/build PASS | features/wiki-mutex/qa-1.md |
| 19 | F05 | wiki-mutex | 1 | compliance | done | PASS — busy/release/abort/double-call all covered | features/wiki-mutex/compliance-1.md |
| 20 | F05 | wiki-mutex | 1 | feature-complete | done | shipped | — |
| 21 | F06 | wiki-widget-framework | 1 | impl | done | controller + view + live/terminal blocks + storybook | features/wiki-widget-framework/impl-1.md |
| 22 | F06 | wiki-widget-framework | 1 | qa | done | typecheck/lint/2156 tests/build PASS | features/wiki-widget-framework/qa-1.md |
| 23 | F06 | wiki-widget-framework | 1 | compliance | done | PASS — phase-dispatch + reload-rehydrate + Zod snapshot | features/wiki-widget-framework/compliance-1.md |
| 24 | F06 | wiki-widget-framework | 1 | feature-complete | done | shipped | — |
| 25 | F07 | wiki-search-warning | 1 | impl | done | searchWarning + tool deps + main wiring | features/wiki-search-warning/impl-1.md |
| 26 | F07 | wiki-search-warning | 1 | qa | done | typecheck/lint/2163 tests/build PASS | features/wiki-search-warning/qa-1.md |
| 27 | F07 | wiki-search-warning | 1 | compliance | done | PASS — warning + rate-limited Notice | features/wiki-search-warning/compliance-1.md |
| 28 | F07 | wiki-search-warning | 1 | feature-complete | done | shipped | — |
| 29 | F08 | wiki-ingest-fetch-persist | 1 | impl | done | fetch + sha256 + persist + duplicate prompt + processSource | features/wiki-ingest-fetch-persist/impl-1.md |
| 30 | F08 | wiki-ingest-fetch-persist | 1 | qa | done | typecheck/lint/2184 tests/build PASS | features/wiki-ingest-fetch-persist/qa-1.md |
| 31 | F08 | wiki-ingest-fetch-persist | 1 | compliance | done | PASS — fetch/persist/dup-detect/timeout all covered | features/wiki-ingest-fetch-persist/compliance-1.md |
| 32 | F08 | wiki-ingest-fetch-persist | 1 | feature-complete | done | shipped | — |
| 33 | F09 | wiki-ingest-subagents | 1 | impl | done | planner + extractor + reducer + semaphore + runBatched | features/wiki-ingest-subagents/impl-1.md |
| 34 | F09 | wiki-ingest-subagents | 1 | qa | done | typecheck/lint/2200 tests/build PASS | features/wiki-ingest-subagents/qa-1.md |
| 35 | F09 | wiki-ingest-subagents | 1 | compliance | done | PASS — Zod retry-once-then-error + semaphore caps | features/wiki-ingest-subagents/compliance-1.md |
| 36 | F09 | wiki-ingest-subagents | 1 | feature-complete | done | shipped | — |
| 37 | F10 | wiki-ingest-writer | 1 | impl | done | writer with deterministic ordering + index regen + log append | features/wiki-ingest-writer/impl-1.md |
| 38 | F10 | wiki-ingest-writer | 1 | qa | done | typecheck/lint/2208 tests/build PASS | features/wiki-ingest-writer/qa-1.md |
| 39 | F10 | wiki-ingest-writer | 1 | compliance | done | PASS — order + partial-failure + index/log all covered | features/wiki-ingest-writer/compliance-1.md |
| 40 | F10 | wiki-ingest-writer | 1 | feature-complete | done | shipped | — |
| 41 | F11 | wiki-ingest-subgraph | 1 | impl | done | refine + FSM driver wires F08+F09+F10+F06+F05 | features/wiki-ingest-subgraph/impl-1.md |
| 42 | F11 | wiki-ingest-subgraph | 1 | qa | done | typecheck/lint/2214 tests/build PASS | features/wiki-ingest-subgraph/qa-1.md |
| 43 | F11 | wiki-ingest-subgraph | 1 | compliance | done | PASS — happy/error/cancel + outer finally | features/wiki-ingest-subgraph/compliance-1.md |
| 44 | F11 | wiki-ingest-subgraph | 1 | feature-complete | done | shipped | — |
| 45 | F12 | wiki-ingest-tool | 1 | impl | done | tool + slash + main wiring + llm adapter | features/wiki-ingest-tool/impl-1.md |
| 46 | F12 | wiki-ingest-tool | 1 | qa | done | typecheck/lint/2218 tests/build PASS | features/wiki-ingest-tool/qa-1.md |
| 47 | F12 | wiki-ingest-tool | 1 | compliance | done | PASS — confirm/deny/busy/done all forward; slash visible | features/wiki-ingest-tool/compliance-1.md |
| 48 | F12 | wiki-ingest-tool | 1 | feature-complete | done | shipped | — |
| 49 | F13 | wiki-ingest-conversation | 1 | impl | done | conversation kind in schema + description; runtime via F08 path | features/wiki-ingest-conversation/impl-1.md |
| 50 | F13 | wiki-ingest-conversation | 1 | qa | done | typecheck/lint/2222 tests/build PASS | features/wiki-ingest-conversation/qa-1.md |
| 51 | F13 | wiki-ingest-conversation | 1 | compliance | done | PASS — schema + persist + FETCHING bypass | features/wiki-ingest-conversation/compliance-1.md |
| 52 | F13 | wiki-ingest-conversation | 1 | feature-complete | done | shipped | — |
| 53 | F14 | wiki-inbox-tool | 1 | impl | done | parser + inbox_add tool + tick/annotate primitives | features/wiki-inbox-tool/impl-1.md |
| 54 | F14 | wiki-inbox-tool | 1 | qa | done | typecheck/lint/2235 tests/build PASS | features/wiki-inbox-tool/qa-1.md |
| 55 | F14 | wiki-inbox-tool | 1 | compliance | done | PASS — round-trip + idempotence + annotation | features/wiki-inbox-tool/compliance-1.md |
| 56 | F14 | wiki-inbox-tool | 1 | feature-complete | done | shipped | — |
| 57 | F15 | wiki-inbox-batch | 1 | impl | done | inbox kind + orchestrator + tool wiring | features/wiki-inbox-batch/impl-1.md |
| 58 | F15 | wiki-inbox-batch | 1 | qa | done | typecheck/lint/2242 tests/build PASS | features/wiki-inbox-batch/qa-1.md |
| 59 | F15 | wiki-inbox-batch | 1 | compliance | done | PASS — sequential drain + tick/annotate + cancel | features/wiki-inbox-batch/compliance-1.md |
| 60 | F15 | wiki-inbox-batch | 1 | feature-complete | done | shipped | — |
| 61 | F16 | wiki-lint-scan | 1 | impl | done | scanWiki + adjacency + orphan detection | features/wiki-lint-scan/impl-1.md |
| 62 | F16 | wiki-lint-scan | 1 | qa | done | typecheck/lint/2244 tests/build PASS | features/wiki-lint-scan/qa-1.md |
| 63 | F16 | wiki-lint-scan | 1 | compliance | done | PASS — enumeration + symmetric adj + orphans | features/wiki-lint-scan/compliance-1.md |
| 64 | F16 | wiki-lint-scan | 1 | feature-complete | done | shipped | — |
| 65 | F17 | wiki-lint-checkers | 1 | impl | done | per-concern checkers + proposing aggregator | features/wiki-lint-checkers/impl-1.md |
| 66 | F17 | wiki-lint-checkers | 1 | qa | done | typecheck/lint/2252 tests/build PASS | features/wiki-lint-checkers/qa-1.md |
| 67 | F17 | wiki-lint-checkers | 1 | compliance | done | PASS — all eight concerns + research-gap invariants + schemaPatch separation | features/wiki-lint-checkers/compliance-1.md |
| 68 | F17 | wiki-lint-checkers | 1 | feature-complete | done | shipped | — |
| 69 | F18 | wiki-lint-subgraph | 1 | impl | done | FSM driver + scope filter + confirm callback + writer | features/wiki-lint-subgraph/impl-1.md |
| 70 | F18 | wiki-lint-subgraph | 1 | qa | done | typecheck/lint/2256 tests/build PASS | features/wiki-lint-subgraph/qa-1.md |
| 71 | F18 | wiki-lint-subgraph | 1 | compliance | done | PASS — happy/cancel/error/finally | features/wiki-lint-subgraph/compliance-1.md |
| 72 | F18 | wiki-lint-subgraph | 1 | feature-complete | done | shipped | — |
| 73 | F19 | wiki-lint-tool | 1 | impl | done | tool + slash + main wiring + setActions bridge + bundle baseline | features/wiki-lint-tool/impl-1.md |
| 74 | F19 | wiki-lint-tool | 1 | qa | done | typecheck/lint/2260 tests/build/bundle PASS | features/wiki-lint-tool/qa-1.md |
| 75 | F19 | wiki-lint-tool | 1 | compliance | done | PASS — confirm/deny/busy/done + schema-patch gate; bundle overrun documented | features/wiki-lint-tool/compliance-1.md |
| 76 | F19 | wiki-lint-tool | 1 | feature-complete | done | shipped | — |
| 77 | — | — | — | workspace-audit | done | clean | — |
