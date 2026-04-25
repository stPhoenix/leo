# Impl state — arch-alignment_plan_20260424-005915

Started: 2026-04-24T01:35:00+00:00
Input mode: workspace (scoped to F01–F03 via user directive)
Project root: /home/bs/PycharmProjects/leo
Entry points:
- src/main.ts
- manifest.json

| # | Feature id | Slug | Iter | Phase | Status | Note | Artifacts |
|---|------------|------|------|-------|--------|------|-----------|
| 1 | F01 | zod-tool-schema | 1 | impl | done | zod adopted via shared adapter; every built-in tool schema migrated; user/MCP tools carry permissive pass-through. | features/zod-tool-schema/impl-1.md |
| 2 | F01 | zod-tool-schema | 1 | qa | done | typecheck/lint/tests/build all PASS; 1091 tests green; bundle +62 KB gz. | features/zod-tool-schema/qa-1.md |
| 3 | F01 | zod-tool-schema | 1 | compliance | done | All 5 ACs PASS; scope covered (one deviation documented); QA clean; integration note recorded. Verdict PASS. | features/zod-tool-schema/compliance-1.md |
| 4 | F01 | zod-tool-schema | 1 | feature-complete | done | F01 shipped. | — |
| 5 | F02 | tool-ctx-adapters | 1 | impl | done | Lifted vault + editor to ToolCtx; migrated 8 built-in tools; wired from main.ts; added regex guard test. | features/tool-ctx-adapters/impl-1.md |
| 6 | F02 | tool-ctx-adapters | 1 | qa | done | typecheck/lint/tests/build all PASS; 1095 tests green; bundle +168 B gz. | features/tool-ctx-adapters/qa-1.md |
| 7 | F02 | tool-ctx-adapters | 1 | compliance | done | All 4 ACs PASS; scope covered; runtime wiring verified in main.ts:543–544. Verdict PASS. | features/tool-ctx-adapters/compliance-1.md |
| 8 | F02 | tool-ctx-adapters | 1 | feature-complete | done | F02 shipped. | — |
| 9 | F03 | builtin-tool-layout | 1 | impl | done | Moved readNote/editNote/createFolder via git mv; split writeTools into createNote + appendToNote; all imports updated. | features/builtin-tool-layout/impl-1.md |
| 10 | F03 | builtin-tool-layout | 1 | qa | done | typecheck/lint/tests/build all PASS; 1095 tests green. | features/builtin-tool-layout/qa-1.md |
| 11 | F03 | builtin-tool-layout | 1 | compliance | done | All 4 ACs PASS; one deviation (createFolder relocated too) documented; integration gate PASS. | features/builtin-tool-layout/compliance-1.md |
| 12 | F03 | builtin-tool-layout | 1 | feature-complete | done | F03 shipped. | — |
| 13 | — | — | — | workspace-audit | done | clean | — |
| 14 | F04 | langgraph-stategraph | 1 | impl | done | Added @langchain/langgraph; graph.ts with GraphBuilder/buildAgentGraph; drive() routed through per-turn compiled StateGraph; legacy loop kept behind USE_GRAPH_RUNTIME flag. | features/langgraph-stategraph/impl-1.md |
| 15 | F04 | langgraph-stategraph | 1 | qa | done | typecheck/lint/tests/build PASS; 1095 tests green; bundle 1.40 MiB. | features/langgraph-stategraph/qa-1.md |
| 16 | F04 | langgraph-stategraph | 1 | compliance | done | All 9 ACs PASS (AC3 with deviation noted); scope fully covered; no out-of-scope leaks; QA clean; integration anchored via USE_GRAPH_RUNTIME in main.ts. Verdict PASS. | features/langgraph-stategraph/compliance-1.md |
| 17 | F04 | langgraph-stategraph | 1 | feature-complete | done | F04 shipped. | — |
| 18 | F05 | graph-interrupt-confirm | 1 | impl | done | Replaced confirmTool callback with LangGraph interrupt() + resume; two-pass handleToolCallsNode (pure Pass 1 / side-effect Pass 2); tool_confirmation stream event; driveLegacy + helpers deleted. | features/graph-interrupt-confirm/impl-1.md |
| 19 | F05 | graph-interrupt-confirm | 1 | qa | done | typecheck/lint/tests/build PASS; 1095 tests; 1.40 MiB bundle. | features/graph-interrupt-confirm/qa-1.md |
| 20 | F05 | graph-interrupt-confirm | 1 | compliance | done | All 6 ACs PASS; scope fully covered; no out-of-scope leaks (tool_confirmation event variant is required by F05 scope, F06 will finish normalising union). Verdict PASS. | features/graph-interrupt-confirm/compliance-1.md |
| 21 | F05 | graph-interrupt-confirm | 1 | feature-complete | done | F05 shipped. | — |
| 22 | F06 | stream-event-union | 1 | impl | done | New src/agent/streamEvents.ts with canonical 7-variant union; graph emits tool_call + tool_result; UI imports flipped; provider events transformed at boundary. | features/stream-event-union/impl-1.md |
| 23 | F06 | stream-event-union | 1 | qa | done | typecheck/lint/tests/build PASS; 1095 tests; 1.40 MiB. | features/stream-event-union/qa-1.md |
| 24 | F06 | stream-event-union | 1 | compliance | done | All 5 ACs PASS; scope fully covered; no leaks. Verdict PASS. | features/stream-event-union/compliance-1.md |
| 25 | F06 | stream-event-union | 1 | feature-complete | done | F06 shipped. | — |
| 26 | F07 | async-iterable-send | 1 | impl | done | send(msg, thread) two-arg signature per arch §4; every caller migrated; EventChannel internal-only. | features/async-iterable-send/impl-1.md |
| 27 | F07 | async-iterable-send | 1 | qa | done | typecheck/lint/tests/build PASS; 1095 tests; 1.40 MiB. | features/async-iterable-send/qa-1.md |
| 28 | F07 | async-iterable-send | 1 | compliance | done | All 5 ACs PASS; scope fully covered; no leaks. Verdict PASS. | features/async-iterable-send/compliance-1.md |
| 29 | F07 | async-iterable-send | 1 | feature-complete | done | F07 shipped. | — |
| 30 | F08 | package-metadata-truth | 1 | impl | done | Deps @langchain/langgraph + zod declared (added by F01, F04); zod-to-json-schema intentionally omitted (zod v4 native); langgraph keyword now accurate; bundle delta documented (+1.02 MB raw / +259 KB gz, accepted per Q4 override). | features/package-metadata-truth/impl-1.md |
| 31 | F08 | package-metadata-truth | 1 | qa | done | typecheck/lint/tests/build/install PASS; 1095 tests; 1.40 MiB raw / 385 KiB gz. | features/package-metadata-truth/qa-1.md |
| 32 | F08 | package-metadata-truth | 1 | compliance | done | 4 ACs PASS (AC1 with technically-grounded deviation on zod-to-json-schema); scope covered; bundle delta documented; lockfile in sync. Verdict PASS. | features/package-metadata-truth/compliance-1.md |
| 33 | F08 | package-metadata-truth | 1 | feature-complete | done | F08 shipped. | — |
| 34 | — | — | — | workspace-audit | done | clean — graph.ts anchored via USE_GRAPH_RUNTIME import in main.ts; streamEvents.ts transitively wired through ui/chatView.tsx (imported from main.ts via ChatStreamStarter type) and chat/streamingController.ts (also main.ts-reachable). | — |
