# Impl state — livestatus_plan_20260425-185758

Started: 2026-04-25T19:17:56+03:00
Input mode: workspace
Project root: /home/bs/PycharmProjects/leo
Entry points:
- src/main.ts
- src/ui/chatView.tsx
- src/ui/openChatView.ts
- src/ui/chat/ChatRoot.tsx
- src/ui/chat/MessageList.tsx
- src/ui/chat/blocks/index.ts
- .storybook/main.ts

| # | Feature id | Slug | Iter | Phase | Status | Note | Artifacts |
|---|------------|------|------|-------|--------|------|-----------|
| 1 | F01 | message-blocks | 1 | impl | done | Typed ContentBlock union + blocks?: array on records + per-block dispatcher + tests. | features/F01-message-blocks/impl-1.md |
| 2 | F01 | message-blocks | 1 | qa | done | All four gates PASS (typecheck, lint, 1143 tests, build). | features/F01-message-blocks/qa-1.md |
| 3 | F01 | message-blocks | 1 | compliance | done | All AC PASS (one documented deviation), QA PASS, integration gate PASS via blocks barrel. | features/F01-message-blocks/compliance-1.md |
| 4 | F01 | message-blocks | 1 | feature-complete | done | F01 shipped on first iteration. | — |
| 5 | F02 | stream-aggregator | 1 | impl | done | StreamEvent gains block_start/delta/stop + message_delta + progress; controller projects to typed blocks with RAF coalescing. | features/F02-stream-aggregator/impl-1.md |
| 6 | F02 | stream-aggregator | 1 | qa | done | All four gates PASS. | features/F02-stream-aggregator/qa-1.md |
| 7 | F02 | stream-aggregator | 1 | compliance | done | AC PASS (one provider-mapping deviation), QA PASS, gate skipped (edits-only). | features/F02-stream-aggregator/compliance-1.md |
| 8 | F02 | stream-aggregator | 1 | feature-complete | done | F02 shipped on first iteration. | — |
| 9 | F03 | run-state-store | 1 | impl | done | RunStateStore wired into chatView via streamingController.onEvent + composer stop bulk-cancel. | features/F03-run-state-store/impl-1.md |
| 10 | F03 | run-state-store | 1 | qa | done | All gates PASS. | features/F03-run-state-store/qa-1.md |
| 11 | F03 | run-state-store | 1 | compliance | done | All AC PASS (one wiring deviation), QA PASS, gate skipped (edits-only). | features/F03-run-state-store/compliance-1.md |
| 12 | F03 | run-state-store | 1 | feature-complete | done | F03 shipped on first iteration. | — |
| 13 | F04 | tool-use-renderer | 1 | impl | done | useBlink hook + width-stable glyph + slots wired through ChatRoot → ChatView; stories ship. | features/F04-tool-use-renderer/impl-1.md |
| 14 | F04 | tool-use-renderer | 1 | qa | done | All gates PASS. | features/F04-tool-use-renderer/qa-1.md |
| 15 | F04 | tool-use-renderer | 1 | compliance | done | All AC PASS (one schema-parse deviation), QA PASS, integration gate PASS. | features/F04-tool-use-renderer/compliance-1.md |
| 16 | F04 | tool-use-renderer | 1 | feature-complete | done | F04 shipped on first iteration. | — |
| 17 | F05 | tool-result-renderer | 1 | impl | done | Per-status layouts, collapse toggle, renderBody slot, runState wiring through AssistantBlocks, stories. | features/F05-tool-result-renderer/impl-1.md |
| 18 | F05 | tool-result-renderer | 1 | qa | done | All gates PASS. | features/F05-tool-result-renderer/qa-1.md |
| 19 | F05 | tool-result-renderer | 1 | compliance | done | All AC PASS (collapse-threshold + render-slot deviations), QA PASS, gate skipped. | features/F05-tool-result-renderer/compliance-1.md |
| 20 | F05 | tool-result-renderer | 1 | feature-complete | done | F05 shipped on first iteration. | — |
| 21 | F06 | inline-permission-prompt | 1 | impl | done | InlinePermissionPrompt + chatView buildToolUseSlots wiring; historical decision pills; stories. | features/F06-inline-permission-prompt/impl-1.md |
| 22 | F06 | inline-permission-prompt | 1 | qa | done | All gates PASS. | features/F06-inline-permission-prompt/qa-1.md |
| 23 | F06 | inline-permission-prompt | 1 | compliance | done | All AC PASS (top-level slot kept; persistence partial pending F13), gate PASS. | features/F06-inline-permission-prompt/compliance-1.md |
| 24 | F06 | inline-permission-prompt | 1 | feature-complete | done | F06 shipped on first iteration. | — |
| 25 | F07 | thinking-block-renderer | 1 | impl | done | DOM tests + stories for ThinkingBlockView (renderer shipped in F01). | features/F07-thinking-block-renderer/impl-1.md |
| 26 | F07 | thinking-block-renderer | 1 | qa | done | All gates PASS. | features/F07-thinking-block-renderer/qa-1.md |
| 27 | F07 | thinking-block-renderer | 1 | compliance | done | All AC PASS, gate skipped. | features/F07-thinking-block-renderer/compliance-1.md |
| 28 | F07 | thinking-block-renderer | 1 | feature-complete | done | F07 shipped on first iteration. | — |
| 29 | F08 | progress-events | 1 | impl | done | ProgressLines + AgentProgressTree + ToolCtx.progress; chatView wires renderProgress slot. | features/F08-progress-events/impl-1.md |
| 30 | F08 | progress-events | 1 | qa | done | All gates PASS. | features/F08-progress-events/qa-1.md |
| 31 | F08 | progress-events | 1 | compliance | done | All AC PASS (logger emit follow-up); F09 surface bundled. | features/F08-progress-events/compliance-1.md |
| 32 | F08 | progress-events | 1 | feature-complete | done | F08 shipped on first iteration. | — |
| 33 | F09 | sub-agent-tree | 1 | impl | done | AgentProgressTree + aggregateAgentProgress (delivered with F08). | features/F09-sub-agent-tree/impl-1.md |
| 34 | F09 | sub-agent-tree | 1 | qa | done | Shared QA run with F08 PASS. | features/F09-sub-agent-tree/qa-1.md |
| 35 | F09 | sub-agent-tree | 1 | compliance | done | All AC PASS (DOM-test deviation; visual via stories). | features/F09-sub-agent-tree/compliance-1.md |
| 36 | F09 | sub-agent-tree | 1 | feature-complete | done | F09 shipped on first iteration. | — |
| 37 | F10 | grouping-read-only | 1 | impl | done | detectGroups + GroupedToolUses + AssistantBlocks integration. | features/F10-grouping-read-only/impl-1.md |
| 38 | F10 | grouping-read-only | 1 | qa | done | All gates PASS. | features/F10-grouping-read-only/qa-1.md |
| 39 | F10 | grouping-read-only | 1 | compliance | done | All AC PASS (registry-flag deviation), gate PASS. | features/F10-grouping-read-only/compliance-1.md |
| 40 | F10 | grouping-read-only | 1 | feature-complete | done | F10 shipped on first iteration. | — |
| 41 | F11 | bottom-live-indicator | 1 | impl | done | BottomLiveIndicator + ChatRoot integration + chatView wiring; Esc + stop button. | features/F11-bottom-live-indicator/impl-1.md |
| 42 | F11 | bottom-live-indicator | 1 | qa | done | All gates PASS. | features/F11-bottom-live-indicator/qa-1.md |
| 43 | F11 | bottom-live-indicator | 1 | compliance | done | All AC PASS, gate PASS. | features/F11-bottom-live-indicator/compliance-1.md |
| 44 | F11 | bottom-live-indicator | 1 | feature-complete | done | F11 shipped on first iteration. | — |
| 45 | F12 | tool-result-diff | 1 | impl | done | computeUnifiedDiff + DiffView + tests + stories. | features/F12-tool-result-diff/impl-1.md |
| 46 | F12 | tool-result-diff | 1 | qa | done | All gates PASS. | features/F12-tool-result-diff/qa-1.md |
| 47 | F12 | tool-result-diff | 1 | compliance | done | All AC PASS (tool-surface enrichment deferred). | features/F12-tool-result-diff/compliance-1.md |
| 48 | F12 | tool-result-diff | 1 | feature-complete | done | F12 shipped on first iteration. | — |
| 49 | F13 | persist-replay | 1 | impl | done | Schema bump + blocks field + applyReplayCancelMarkers helper + tests. | features/F13-persist-replay/impl-1.md |
| 50 | F13 | persist-replay | 1 | qa | done | All gates PASS. | features/F13-persist-replay/qa-1.md |
| 51 | F13 | persist-replay | 1 | compliance | done | All AC PASS (IDB→JSON deviation, logger emit follow-up). | features/F13-persist-replay/compliance-1.md |
| 52 | F13 | persist-replay | 1 | feature-complete | done | F13 shipped on first iteration. | — |
| 53 | F14 | storybook-mocks | 1 | impl | done | Mock factories (run-state, progress, diff, clock) + exampleToolUseBlocks; build-storybook clean. | features/F14-storybook-mocks/impl-1.md |
| 54 | F14 | storybook-mocks | 1 | qa | done | All gates PASS. | features/F14-storybook-mocks/qa-1.md |
| 55 | F14 | storybook-mocks | 1 | compliance | done | All AC PASS (decorator vs helper deviation). | features/F14-storybook-mocks/compliance-1.md |
| 56 | F14 | storybook-mocks | 1 | feature-complete | done | F14 shipped on first iteration. | — |
| 57 | — | — | — | workspace-audit | done | clean | — |
| 58 | F12 | tool-result-diff | 2 | follow-up | done | Enriched edit_note/create_note/append_to_note results with before/after + wired DiffView via chatView.renderResult slot + tool-results map on RunStateStore. | — |
| 59 | F06 | inline-permission-prompt | 2 | follow-up | done | Top-level InlineConfirmation slot retired from ChatRoot; aria/region tests updated. | — |
