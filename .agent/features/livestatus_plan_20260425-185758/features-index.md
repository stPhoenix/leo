# Features index

Sequenced top-to-bottom; later features depend only on earlier ones. Storybook coverage threads through every UI-visible feature; F14 captures the cross-cutting mock layer.

| # | id | slug | name | purpose | deps | ui-needed | priority | covers |
|---|----|------|------|---------|------|-----------|----------|--------|
| 1 | F01 | message-blocks | Tagged-union message content | Replace `ChatMessageRecord.content: string` with `content: ContentBlock[]`; wire renderers to read blocks. | — | yes | high | FR-01, FR-06, FR-07, NFR-04 |
| 2 | F02 | stream-aggregator | Stream aggregator → typed blocks | Map provider stream events to per-index content-block updates; buffer tool-use input JSON. | F01 | no | high | FR-02, FR-03, NFR-02, NFR-09 |
| 3 | F03 | run-state-store | Run-state store | Track per-tool-use lifecycle + progress map + permission map outside message store. | F01 | no | high | FR-04, FR-05, NFR-03, NFR-09, NFR-11 |
| 4 | F04 | tool-use-renderer | Tool-use block renderer | Header glyph + blink + args (default + custom hook); shells subsequent result/progress slots. | F01, F02, F03 | yes | high | FR-06, FR-08, FR-09, NFR-04, NFR-05, NFR-06 |
| 5 | F05 | tool-result-renderer | Tool-result panel | Status-driven result panel mounted under the matching tool-use block. | F04 | yes | high | FR-11, NFR-05, NFR-06 |
| 6 | F06 | inline-permission-prompt | Inline permission prompt | Reposition confirmation dialog inline above tool-use args; persist decision for replay. | F03, F04 | yes | high | FR-10, NFR-05, NFR-12 |
| 7 | F07 | thinking-block-renderer | Thinking block renderer | Italic dim collapsible block; redacted variant. | F01, F02 | yes | medium | FR-12, NFR-05 |
| 8 | F08 | progress-events | Progress events plumbing | Extend stream events; tool runners emit progress; render ephemeral lines under tool-use. | F03, F04 | yes | high | FR-13, NFR-09, NFR-10 |
| 9 | F09 | sub-agent-tree | Sub-agent progress tree | Aggregate `agent`-kind progress per agentId; render tree under launcher tool. | F08 | yes | medium | FR-14, NFR-04 |
| 10 | F10 | grouping-read-only | Grouping for read-only tools | Collapse adjacent resolved read-only tool-uses into a single expandable summary. | F04, F05 | yes | medium | FR-15, NFR-04 |
| 11 | F11 | bottom-live-indicator | Bottom-of-chat live indicator | Persistent status line; stalled detector; Esc-cancel. | F02, F03 | yes | high | FR-17, NFR-05, NFR-07, NFR-11 |
| 12 | F12 | tool-result-diff | Tool-result diff renderer | Unified diff for editNote/createNote/appendToNote results. | F05 | yes | medium | FR-16, NFR-01 |
| 13 | F13 | persist-replay | Persistence + replay | Persist typed blocks; on load mark unresolved tool-uses canceled; legacy migration. | F01, F03 | no | high | FR-18, FR-19, NFR-08 |
| 14 | F14 | storybook-mocks | Storybook coverage + shared mocks | Reusable mocks (stream events, run-state, tool defs, progress) + per-feature stories baseline. | F01–F12 (consumes) | yes | high | FR-20, NFR-13 |

Order rationale: schema first (F01), then plumbing without UI (F02 + F03), then visible renderers from inside out (tool-use → result → permission prompt → thinking), then enriched experiences (progress, sub-agent, grouping), then chrome (live indicator), then polish (diff). Persistence (F13) lands after the new schema is stable. Storybook (F14) is a cross-cutting feature that consumes earlier features but its mocks and patterns are introduced incrementally — each feature's per-component story is delivered with the feature; F14 only owns *shared* mocks and the Storybook configuration delta.

Coverage check: every FR (FR-01 … FR-20) appears in at least one row's `covers`. Every NFR (NFR-01 … NFR-13) appears in at least one row's `covers`.
