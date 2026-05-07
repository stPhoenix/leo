# Impl state — canvas_slice_20260505-190819

Started: 2026-05-05T19:38:24+03:00
Input mode: workspace
Project root: /home/bs/PycharmProjects/leo
Entry points:
- src/main.ts

| # | Feature id | Slug | Iter | Phase | Status | Note | Artifacts |
|---|------------|------|------|-------|--------|------|-----------|
| 1 | F01 | canvas-json | 1 | impl | done | Zod schemas + parse/serialize + path validators + fixtures + unit tests | features/canvas-json/impl-1.md |
| 2 | F01 | canvas-json | 1 | qa | done | All gates PASS | features/canvas-json/qa-1.md |
| 3 | F01 | canvas-json | 1 | compliance | done | PASS | features/canvas-json/compliance-1.md |
| 4 | F01 | canvas-json | 1 | feature-complete | done | shipped | — |
| 5 | F02 | canvas-navigator | 1 | impl | done | CanvasNavigator adapter + feature-detected zoomToBbox + 7 unit tests | features/canvas-navigator/impl-1.md |
| 6 | F02 | canvas-navigator | 1 | qa | done | All gates PASS | features/canvas-navigator/qa-1.md |
| 7 | F02 | canvas-navigator | 1 | compliance | done | PASS | features/canvas-navigator/compliance-1.md |
| 8 | F02 | canvas-navigator | 1 | feature-complete | done | shipped | — |
| 9 | F03 | reveal-in-canvas-tool | 1 | impl | done | reveal_in_canvas tool + ToolCtx threading + plan-mode allowlist + main.ts wiring | features/reveal-in-canvas-tool/impl-1.md |
| 10 | F03 | reveal-in-canvas-tool | 1 | qa | done | All gates PASS | features/reveal-in-canvas-tool/qa-1.md |
| 11 | F03 | reveal-in-canvas-tool | 1 | compliance | done | PASS | features/reveal-in-canvas-tool/compliance-1.md |
| 12 | F03 | reveal-in-canvas-tool | 1 | feature-complete | done | shipped | — |
| 13 | F04 | canvas-budgets-runid-slug | 1 | impl | done | budgets/runId/slug helpers + 10 tests | features/canvas-budgets-runid-slug/impl-1.md |
| 14 | F04 | canvas-budgets-runid-slug | 1 | qa | done | All gates PASS | features/canvas-budgets-runid-slug/qa-1.md |
| 15 | F04 | canvas-budgets-runid-slug | 1 | compliance | done | PASS | features/canvas-budgets-runid-slug/compliance-1.md |
| 16 | F04 | canvas-budgets-runid-slug | 1 | feature-complete | done | shipped | — |
| 17 | F05 | canvas-logging-namespaces | 1 | impl | done | CANVAS_LOG tree + sensitive fields + snapshot | features/canvas-logging-namespaces/impl-1.md |
| 18 | F05 | canvas-logging-namespaces | 1 | qa | done | All gates PASS | features/canvas-logging-namespaces/qa-1.md |
| 19 | F05 | canvas-logging-namespaces | 1 | compliance | done | PASS | features/canvas-logging-namespaces/compliance-1.md |
| 20 | F05 | canvas-logging-namespaces | 1 | feature-complete | done | shipped | — |
| 21 | F06 | canvas-mutex | 1 | impl | done | CanvasMutex per-path gate + 6 tests | features/canvas-mutex/impl-1.md |
| 22 | F06 | canvas-mutex | 1 | qa | done | All gates PASS | features/canvas-mutex/qa-1.md |
| 23 | F06 | canvas-mutex | 1 | compliance | done | PASS | features/canvas-mutex/compliance-1.md |
| 24 | F06 | canvas-mutex | 1 | feature-complete | done | shipped | — |
| 25 | F07 | canvas-sidecar | 1 | impl | done | schemas.ts shared Zod + sidecar read/write/atomic-rename + 7 tests | features/canvas-sidecar/impl-1.md |
| 26 | F07 | canvas-sidecar | 1 | qa | done | All gates PASS | features/canvas-sidecar/qa-1.md |
| 27 | F07 | canvas-sidecar | 1 | compliance | done | PASS | features/canvas-sidecar/compliance-1.md |
| 28 | F07 | canvas-sidecar | 1 | feature-complete | done | shipped | — |
| 29 | F08 | canvas-refine | 1 | impl | done | refine sub-agent + system prompt + 11 tests | features/canvas-refine/impl-1.md |
| 30 | F08 | canvas-refine | 1 | qa | done | All gates PASS | features/canvas-refine/qa-1.md |
| 31 | F08 | canvas-refine | 1 | compliance | done | PASS | features/canvas-refine/compliance-1.md |
| 32 | F08 | canvas-refine | 1 | feature-complete | done | shipped | — |
| 33 | F09 | canvas-source-planner | 1 | impl | done | source-hint expander + per-kind + dedupe/cap + 8 tests | features/canvas-source-planner/impl-1.md |
| 34 | F09 | canvas-source-planner | 1 | qa | done | All gates PASS | features/canvas-source-planner/qa-1.md |
| 35 | F09 | canvas-source-planner | 1 | compliance | done | PASS | features/canvas-source-planner/compliance-1.md |
| 36 | F09 | canvas-source-planner | 1 | feature-complete | done | shipped | — |
| 37 | F10 | canvas-source-fetcher | 1 | impl | done | 1:1 fetcher adapter + per-source error capture + 7 tests | features/canvas-source-fetcher/impl-1.md |
| 38 | F10 | canvas-source-fetcher | 1 | qa | done | All gates PASS | features/canvas-source-fetcher/qa-1.md |
| 39 | F10 | canvas-source-fetcher | 1 | compliance | done | PASS | features/canvas-source-fetcher/compliance-1.md |
| 40 | F10 | canvas-source-fetcher | 1 | feature-complete | done | shipped | — |
| 41 | F11 | canvas-extractor | 1 | impl | done | extractor sub-agent + semaphore + retry + 7 tests | features/canvas-extractor/impl-1.md |
| 42 | F11 | canvas-extractor | 1 | qa | done | All gates PASS | features/canvas-extractor/qa-1.md |
| 43 | F11 | canvas-extractor | 1 | compliance | done | PASS | features/canvas-extractor/compliance-1.md |
| 44 | F11 | canvas-extractor | 1 | feature-complete | done | shipped | — |
| 45 | F12 | canvas-reducer | 1 | impl | done | reducer + insights + optional LLM-alias + 9 tests | features/canvas-reducer/impl-1.md |
| 46 | F12 | canvas-reducer | 1 | qa | done | All gates PASS | features/canvas-reducer/qa-1.md |
| 47 | F12 | canvas-reducer | 1 | compliance | done | PASS | features/canvas-reducer/compliance-1.md |
| 48 | F12 | canvas-reducer | 1 | feature-complete | done | shipped | — |
| 49 | F13 | canvas-layouts | 1 | impl | done | 6 presets + auto + node-size + free-space + edge labels + 16 tests | features/canvas-layouts/impl-1.md |
| 50 | F13 | canvas-layouts | 1 | qa | done | All gates PASS | features/canvas-layouts/qa-1.md |
| 51 | F13 | canvas-layouts | 1 | compliance | done | PASS | features/canvas-layouts/compliance-1.md |
| 52 | F13 | canvas-layouts | 1 | feature-complete | done | shipped | — |
| 53 | F14 | canvas-diff | 1 | impl | done | diff + lock detection + tombstone helpers + 14 tests | features/canvas-diff/impl-1.md |
| 54 | F14 | canvas-diff | 1 | qa | done | All gates PASS | features/canvas-diff/qa-1.md |
| 55 | F14 | canvas-diff | 1 | compliance | done | PASS | features/canvas-diff/compliance-1.md |
| 56 | F14 | canvas-diff | 1 | feature-complete | done | shipped | — |
| 57 | F15 | canvas-writer | 1 | impl | done | preview/commit/cleanup/sidecar/target-guard + 9 tests | features/canvas-writer/impl-1.md |
| 58 | F15 | canvas-writer | 1 | qa | done | All gates PASS | features/canvas-writer/qa-1.md |
| 59 | F15 | canvas-writer | 1 | compliance | done | PASS | features/canvas-writer/compliance-1.md |
| 60 | F15 | canvas-writer | 1 | feature-complete | done | shipped | — |
| 61 | F16 | canvas-subgraph | 1 | impl | done | hand-rolled FSM driver + state types + 7 tests | features/canvas-subgraph/impl-1.md |
| 62 | F16 | canvas-subgraph | 1 | qa | done | All gates PASS | features/canvas-subgraph/qa-1.md |
| 63 | F16 | canvas-subgraph | 1 | compliance | done | PASS | features/canvas-subgraph/compliance-1.md |
| 64 | F16 | canvas-subgraph | 1 | feature-complete | done | shipped | — |
| 65 | F17 | canvas-widget-live | 1 | impl | done | controller + view model + live registry + widget + 11 tests + 11 stories | features/canvas-widget-live/impl-1.md |
| 66 | F17 | canvas-widget-live | 1 | qa | done | All gates PASS | features/canvas-widget-live/qa-1.md |
| 67 | F17 | canvas-widget-live | 1 | compliance | done | PASS | features/canvas-widget-live/compliance-1.md |
| 68 | F17 | canvas-widget-live | 1 | feature-complete | done | shipped | — |
| 69 | F18 | canvas-widget-terminal | 1 | impl | done | terminal snapshot zod + builder + parser + block + 7 stories + 6 tests | features/canvas-widget-terminal/impl-1.md |
| 70 | F18 | canvas-widget-terminal | 1 | qa | done | All gates PASS | features/canvas-widget-terminal/qa-1.md |
| 71 | F18 | canvas-widget-terminal | 1 | compliance | done | PASS | features/canvas-widget-terminal/compliance-1.md |
| 72 | F18 | canvas-widget-terminal | 1 | feature-complete | done | shipped | — |
| 73 | F19 | delegate-canvas-create | 1 | impl | done | tool + orchestrator + previewing dispatcher + main.ts wiring + 19 tests | features/delegate-canvas-create/impl-1.md |
| 74 | F19 | delegate-canvas-create | 1 | qa | done | All gates PASS | features/delegate-canvas-create/qa-1.md |
| 75 | F19 | delegate-canvas-create | 1 | compliance | done | PASS | features/delegate-canvas-create/compliance-1.md |
| 76 | F19 | delegate-canvas-create | 1 | feature-complete | done | shipped | — |
| 77 | F20 | delegate-canvas-content-edit | 1 | impl | done | content-edit tool + shared confirm flow + sidecar/canvas pre-flight + 8 tests | features/delegate-canvas-content-edit/impl-1.md |
| 78 | F20 | delegate-canvas-content-edit | 1 | qa | done | All gates PASS | features/delegate-canvas-content-edit/qa-1.md |
| 79 | F20 | delegate-canvas-content-edit | 1 | compliance | done | PASS | features/delegate-canvas-content-edit/compliance-1.md |
| 80 | F20 | delegate-canvas-content-edit | 1 | feature-complete | done | shipped | — |
| 81 | F21 | delegate-canvas-layout-edit | 1 | impl | done | layout-edit tool + subgraph degenerate freshState branch + 9 tests | features/delegate-canvas-layout-edit/impl-1.md |
| 82 | F21 | delegate-canvas-layout-edit | 1 | qa | done | All gates PASS | features/delegate-canvas-layout-edit/qa-1.md |
| 83 | F21 | delegate-canvas-layout-edit | 1 | compliance | done | PASS | features/delegate-canvas-layout-edit/compliance-1.md |
| 84 | F21 | delegate-canvas-layout-edit | 1 | feature-complete | done | shipped | — |
| 85 | F22 | canvas-slash-commands | 1 | impl | done | /canvas-create + /canvas-edit + /canvas-status snapshot widget + 8 tests + 4 stories | features/canvas-slash-commands/impl-1.md |
| 86 | F22 | canvas-slash-commands | 1 | qa | done | All gates PASS | features/canvas-slash-commands/qa-1.md |
| 87 | F22 | canvas-slash-commands | 1 | compliance | done | PASS | features/canvas-slash-commands/compliance-1.md |
| 88 | F22 | canvas-slash-commands | 1 | feature-complete | done | shipped | — |
| 89 | F23 | canvas-bundle-perf-harden | 1 | impl | done | bundle baseline reset + 50/200-node bench + golden shapes + REPORT | features/canvas-bundle-perf-harden/impl-1.md |
| 90 | F23 | canvas-bundle-perf-harden | 1 | qa | done | All gates PASS | features/canvas-bundle-perf-harden/qa-1.md |
| 91 | F23 | canvas-bundle-perf-harden | 1 | compliance | done | PASS | features/canvas-bundle-perf-harden/compliance-1.md |
| 92 | F23 | canvas-bundle-perf-harden | 1 | feature-complete | done | shipped | — |
| 93 | — | — | — | workspace-audit | done | clean | — |
