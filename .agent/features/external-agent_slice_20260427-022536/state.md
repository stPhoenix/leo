# State — external-agent slice 20260427-022536

| # | Phase | Iteration | Status | Note | Output docs |
|---|-------|-----------|--------|------|-------------|
| 1 | analyze | — | done | Captured 34 FR-EXT + 8 NFR-EXT + 9 constraints + glossary + 8 open questions | context.md |
| 2 | slice | — | done | 13 features sequenced; 2 ui-needed (F08, F11) | features-index.md |
| 3 | detail:adapter-contract | — | done | F01 spec written | features/adapter-contract/feature.md |
| 4 | detail:result-writer | — | done | F02 spec written | features/result-writer/feature.md |
| 5 | detail:subgraph-state-machine | — | done | F03 spec written | features/subgraph-state-machine/feature.md |
| 6 | detail:refine-sub-agent | — | done | F04 spec written | features/refine-sub-agent/feature.md |
| 7 | detail:run-phase | — | done | F05 spec written | features/run-phase/feature.md |
| 8 | detail:delegate-external-tool | — | done | F06 spec written | features/delegate-external-tool/feature.md |
| 9 | detail:widget-controller | — | done | F07 spec written | features/widget-controller/feature.md |
| 10 | detail:widget-ui | — | done | F08 spec written; ui.md pending | features/widget-ui/feature.md |
| 11 | detail:adapter-claude-code | — | done | F09 spec written | features/adapter-claude-code/feature.md |
| 12 | detail:adapter-openai-compatible | — | done | F10 spec written | features/adapter-openai-compatible/feature.md |
| 13 | detail:settings-ui | — | done | F11 spec written; ui.md pending | features/settings-ui/feature.md |
| 14 | detail:history-persistence | — | done | F12 spec written | features/history-persistence/feature.md |
| — | scope-revision | — | done | F09/F10 removed; SRS, context.md, features-index.md, F11 updated; F09/F10 spec dirs deleted | features-index.md (revised), context.md (revised), settings-ui/feature.md (revised), .agent/srs/external-agent.md (revised) |
| 15 | detail:logging-bundle | — | done | F13 spec written | features/logging-bundle/feature.md |
| 16 | ui:widget-ui | — | done | F08 ui.md written with 14-story matrix | features/widget-ui/ui.md |
| 17 | ui:settings-ui | — | done | F11 ui.md written with 6-story matrix incl. NoAdaptersRegistered v1 fixture | features/settings-ui/ui.md |
| 18 | verify | 1 | done | FAIL — Check 7 (2 over-budget bullets in F03 + F04 Implementation notes) | verification-1.md |
| 19 | remediate | 1 | done | Tightened F03 + F04 Implementation-notes bullets; relocated reasoning into features-index.md compliance summary | remediation-1.md, features/subgraph-state-machine/feature.md, features/refine-sub-agent/feature.md, features-index.md |
| 20 | verify | 2 | done | PASS — all 8 checks | verification-2.md |
