# State — inline-agent plan 20260427-162900

| # | Phase | Iteration | Status | Note | Output docs |
|---|-------|-----------|--------|------|-------------|
| 1 | analyze | — | done | Captured FR-IA-01..51 + NFR-IA-01..07 + constraints, glossary, open questions from SRS. | context.md |
| 2 | slice | — | done | 18 features F01–F18, topologically ordered, every FR/NFR covered. | features-index.md |
| 3 | detail:adapter-scaffold | — | done | F01 detailed — class skeleton, ESLint isolation, DI wiring. | features/adapter-scaffold/feature.md |
| 4 | detail:config-schema | — | done | F02 detailed — Zod schema, system prompt, NFR-IA-01 caveat surfacing. | features/config-schema/feature.md |
| 5 | detail:sandbox-primitives | — | done | F03 detailed — Sandbox class, path-prefix + symlink guard, quota, finally cleanup, orphan sweep. | features/sandbox-primitives/feature.md |
| 6 | detail:run-state-budgets | — | done | F04 detailed — runState data + budgets helpers + abort composition. | features/run-state-budgets/feature.md |
| 7 | detail:event-bridge | — | done | F05 detailed — stream→ExternalEvent translator, elision rules, error mapping. | features/event-bridge/feature.md |
| 8 | detail:tool-fetch-url | — | done | F06 detailed — fetch_url with allow/block, timeout, byte cap, redirect re-check. | features/tool-fetch-url/feature.md |
| 9 | detail:tool-search-web | — | done | F07 detailed — Tavily search with key indirection, status mapping, byte cap, log elision. | features/tool-search-web/feature.md |
| 10 | detail:tool-file-ops | — | done | F08 detailed — read/write/list/delete with quota + error mapping. | features/tool-file-ops/feature.md |
| 11 | detail:tool-publish-artifact | — | done | F09 detailed — nomination buffer + terminal flush + missing-artifact warn-skip. | features/tool-publish-artifact/feature.md |
| 12 | detail:tool-extract-note | — | done | F10 detailed — extract_note tool + message rewriter helpers. | features/tool-extract-note/feature.md |
| 13 | detail:router-classify | — | done | F11 detailed — classifier with retry + routing-mode override + fallback. | features/router-classify/feature.md |
| 14 | detail:branch-simple | — | done | F12 detailed — createReactAgent simple branch with cap + partial flush. | features/branch-simple/feature.md |
| 15 | detail:multistep-planner | — | done | F13 detailed — planner with initialPlan + structured-output fallback to simple. | features/multistep-planner/feature.md |
| 16 | detail:multistep-research-step | — | done | F14 detailed — bounded ReAct per step + rewrite + boundary drop + budget rollover. | features/multistep-research-step/feature.md |
| 17 | detail:multistep-synthesize | — | done | F15 detailed — synthesize with notes-only prompt + publish_artifact only. | features/multistep-synthesize/feature.md |
| 18 | detail:graph-wiring | — | done | F16 detailed — top-level StateGraph + recursion guard + abort composition + finally cleanup. | features/graph-wiring/feature.md |
| 19 | detail:bundle-budget | — | done | F17 detailed — `main.js` ≤25 KB delta + baseline update. | features/bundle-budget/feature.md |
| 20 | detail:test-fixtures-stories | — | done | F18 detailed — fakeChatModel, msw fixtures, integration tests, Storybook scenarios. | features/test-fixtures-stories/feature.md |
| 21 | ui:test-fixtures-stories | — | done | F18 UI doc — Storybook scenarios, layout, state machine, component map. | features/test-fixtures-stories/ui.md |
| 22 | verify | 1 | done | All 8 checks PASS — coverage forward/back, DAG, UI, outline, sections, no-dup, link resolution. | verification-1.md |
