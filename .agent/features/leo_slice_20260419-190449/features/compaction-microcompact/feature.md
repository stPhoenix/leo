# F42 — Microcompaction layer

## Purpose

Deliver the pre-API microcompaction pass that sits between [F10 AgentController](../agent-controller-core/feature.md)'s assembled message list and `ProviderManager.stream()`: given the in-memory messages plus the 3-tier estimator from [F41](../token-estimator-3tier/feature.md), it replaces the `content` of older compactable `tool_result` blocks with the marker `"[Old tool result content cleared]"` while keeping every `tool_use` ↔ `tool_result` pairing intact, preserving streaming-chunk adjacency for `thinking` / `tool_use` blocks that share a `message.id`, inserting a `SystemMicrocompactBoundaryMessage` marker where pruning fired, and returning the trimmed messages without ever calling the summarization LLM. It satisfies [FR-COMPACT-07](../../context.md#fr-compact-07) and is the Layer-1 step in the query-loop order `history-snip → microcompact → collapse → autocompact → API` fixed in [compact.md §1](../../../../srs/compact.md#1-overview), so it is the prerequisite pass every downstream feature (F43 autocompact, F46 ContextAnalyzer) runs behind.

## Scope

### In scope

- Pure `microcompactMessages(messages, ctx?, querySource?)` module returning `{messages, boundaryMarker?, tokensSaved}` per [compact.md §5](../../../../srs/compact.md#5-layer-1-microcompaction); no IO, no React, no Obsidian imports.
- Compactable-tool allowlist sourced from [compact.md §5 "Compactable Tools"](../../../../srs/compact.md#5-layer-1-microcompaction) mapped to Leo's registry: `read_note`, `edit_note`, `create_note`, `append_to_note`, `search_vault` (plus any MCP read tool whose `ToolSpec.source === "mcp"` and whose registry entry opts in); write-confirmation-required tools are never cleared.
- Path A (time-based) behaviour from [compact.md §5](../../../../srs/compact.md#5-layer-1-microcompaction): when the gap since the last assistant message exceeds `gapThresholdMinutes` (default 60), collect compactable `tool_use` ids in order, keep the last `keepRecent` (default 5, minimum 1), and replace older `tool_result.content` with `"[Old tool result content cleared]"`.
- API-invariant preservation per [compact.md §15](../../../../srs/compact.md#15-api-invariant-preservation): every kept `tool_result` still points at a surviving `tool_use` in a kept assistant message; streaming chunks that share `message.id` stay adjacent; `skill_discovery` / `skill_listing` attachments are left untouched (they are stripped pre-summary only by F43).
- `SystemMicrocompactBoundaryMessage` insertion at the point of the clearing pass so F46's post-boundary filter can find it later.
- Token-saved telemetry hook: emits a `microcompact.cleared` structured log event through F01's `Logger` carrying `{gapMinutes, toolsCleared, toolsKept, keepRecent, tokensSaved}` and returns `tokensSaved` to the caller; if `tokensSaved === 0` the function returns `null` (fall-through, messages unchanged).
- Pre-API ordering contract: [F10 AgentController](../agent-controller-core/feature.md) calls `microcompactMessages` immediately after `ContextAssembler` assembly and before handing the prompt to `ProviderManager.stream`, so the provider receives the pruned messages.
- Vitest coverage for: compactable-tool allowlist gating, time-gap threshold gating, `keepRecent` retention, `tool_use`↔`tool_result` pairing preservation, thinking-block continuity (two assistant messages sharing one `message.id`), boundary-marker insertion, null-return on zero savings, and no-summarization-call assertion.

### Out of scope

- Path B cached microcompaction (`cache_edits` API feature) — LM Studio does not expose cache-edit semantics in v1; deferred until a provider that does ships per the [compact.md §5 Path B](../../../../srs/compact.md#5-layer-1-microcompaction) guard conditions.
- Threshold-triggered full-conversation summarization, the verbatim summarization prompt from [compact.md §10](../../../../srs/compact.md#10-summarization-prompts), post-compact message assembly order, and all Layer-2 work → ship with [F43](../../features-index.md).
- PTL retry / group head-truncation → [F44](../../features-index.md).
- Circuit breaker → [F45](../../features-index.md).
- ContextAnalyzer pipeline, `/context` grid, suggestions, status line → F46 / F47 / F48.
- Session-memory compaction (Layer 4) — marked out of scope in [context.md Out of scope](../../context.md#out-of-scope).
- Feature-flag surface (`tengu_slate_heron`, `CACHED_MICROCOMPACT`, etc.) — Leo ships with the time-based path always enabled; the remote-config plumbing from [compact.md §5](../../../../srs/compact.md#5-layer-1-microcompaction) is out of scope.

## Acceptance criteria

1. `microcompactMessages(messages, ctx?, querySource?)` runs synchronously and never makes any LLM call; the Vitest suite asserts zero `ProviderManager.stream` / `fetch` invocations across the full matrix of inputs. (FR-COMPACT-07, [compact.md §5](../../../../srs/compact.md#5-layer-1-microcompaction))
2. For every kept `tool_result` block in the returned messages, the matching `tool_use` block (same `tool_use_id`) is present in a preserved earlier assistant message — the invariant from [compact.md §15 "Tool Use / Tool Result Pairing"](../../../../srs/compact.md#15-api-invariant-preservation) — verified by a Vitest fixture that toggles between cleared and uncleared tool rounds. (FR-COMPACT-07)
3. Streaming-chunk adjacency is preserved: any two assistant messages sharing a `message.id` (i.e. split `thinking` / `tool_use` chunks) either both survive or both get cleared; neither can be split mid-stream — verified by a Vitest fixture reproducing the [compact.md §15 "Thinking Block Continuity"](../../../../srs/compact.md#15-api-invariant-preservation) case. (FR-COMPACT-07)
4. Only `tool_result` blocks whose `tool_use_id` maps to a tool in the [compact.md §5 "Compactable Tools"](../../../../srs/compact.md#5-layer-1-microcompaction) allowlist (Leo mapping: `read_note`, `edit_note`, `create_note`, `append_to_note`, `search_vault`, plus opt-in MCP read tools) are eligible for clearing; other tool results pass through untouched. (FR-COMPACT-07)
5. When time-based mode fires (gap ≥ `gapThresholdMinutes`, default 60), the last `keepRecent` (default 5, minimum 1) compactable `tool_use` ids — collected in the order they appear in assistant messages — retain their original `tool_result.content`; all older compactable `tool_result.content` values are replaced with the literal string `"[Old tool result content cleared]"`. (FR-COMPACT-07, [compact.md §5 Path A](../../../../srs/compact.md#5-layer-1-microcompaction))
6. The function never summarizes: returned messages preserve the original assistant `text` / `thinking` / `tool_use` bodies verbatim, user messages verbatim, and only the `content` field of eligible `tool_result` blocks is rewritten; the Vitest suite asserts byte-identical non-`tool_result` content. (FR-COMPACT-07, [compact.md §5](../../../../srs/compact.md#5-layer-1-microcompaction))
7. Pre-API ordering: [F10 AgentController](../agent-controller-core/feature.md)'s turn loop calls `microcompactMessages` after `ContextAssembler.assemble` and before `ProviderManager.stream`; a Vitest integration test with a mocked `ProviderManager` asserts the `prompt` it receives is the microcompacted output, and the call happens on the same synchronous path as assembly (no interleaving with the network call). (FR-COMPACT-07, [compact.md §1 "Execution order in the query loop"](../../../../srs/compact.md#1-overview))
8. A `SystemMicrocompactBoundaryMessage` is inserted into the returned message list at the point of clearing so F46's post-boundary filter can locate it; when `tokensSaved === 0` the function returns `null` (messages unchanged, no boundary inserted), matching the [compact.md §5 Path A](../../../../srs/compact.md#5-layer-1-microcompaction) "if no tokens saved, return null" rule. (FR-COMPACT-07)
9. A `microcompact.cleared` structured log event is emitted via F01's `Logger` with fields `{gapMinutes, toolsCleared, toolsKept, keepRecent, tokensSaved}`; `tokensSaved` is computed using [F41](../token-estimator-3tier/feature.md)'s estimator before and after the clearing pass, not via summarization. (FR-COMPACT-07, NFR-LOG-04)

## Dependencies

- [F41 token-estimator-3tier](../token-estimator-3tier/feature.md) — supplies `estimateMessageTokens` / `tokenCountWithEstimation` for the `tokensSaved` calculation and any future threshold gating.
- [F10 agent-controller-core](../agent-controller-core/feature.md) — this module slots into `AgentRunner`'s turn loop between `ContextAssembler.assemble` and `ProviderManager.stream` per the [compact.md §1](../../../../srs/compact.md#1-overview) execution order.
- [context.md#fr-compact-07](../../context.md#fr-compact-07) — authoritative requirement + companion-doc invariants.
- [context.md#fr-compact-01](../../context.md#fr-compact-01) — names microcompaction as Layer 1 of the layered pipeline; F43 owns the top-level requirement but this feature delivers its Layer 1.
- [compact.md §5 Microcompaction](../../../../srs/compact.md#5-layer-1-microcompaction), [§14 Message Grouping](../../../../srs/compact.md#14-message-grouping), [§15 API Invariant Preservation](../../../../srs/compact.md#15-api-invariant-preservation) — authoritative external spec; rules not restated here.
- Downstream: F43 autocompaction, F44 PTL retry, F46 ContextAnalyzer — all run behind this pass.

## Implementation notes

- [Architecture §3.2 Agent Layer](../../../../architecture/architecture.md#32-agent-layer) — module colocates with `AgentRunner` / `ContextAssembler` / `Truncator` in the agent layer.
- [Architecture §3.3 Domain / Core (pure)](../../../../architecture/architecture.md#33-domain--core-pure) — fits the "pure input → transformed messages" contract used by `Truncator`.
- [Architecture §4 Key Contracts](../../../../architecture/architecture.md#4-key-contracts) — `ToolSpec.id` / `source` drive the compactable-tool allowlist check.
- [Architecture §5.2 Chat Turn (no tools)](../../../../architecture/architecture.md#52-chat-turn-no-tools) — microcompact inserts between `ContextAssembler` and `ProviderManager.stream` in this flow.
- [Architecture §5.3 Chat Turn (with tool call + confirmation)](../../../../architecture/architecture.md#53-chat-turn-with-tool-call--confirmation) — tool_use/tool_result pairs visible on this flow are the invariant target.
- [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) — pure module has no lifecycle; callers own their `AbortController`.
- [Tech stack — Agent Layer](../../../../standards/tech-stack.md#agent-layer) pins LangGraph as the turn-loop host this module slots into.
- [Code style — TypeScript](../../../../standards/code-style.md#typescript) and [Async & Concurrency](../../../../standards/code-style.md#async--concurrency) govern the synchronous, pure-function surface.
- [Code style — LangGraph / Agent Layer](../../../../standards/code-style.md#langgraph--agent-layer) — typed state, no thrown errors escaping, `AbortSignal` threading conventions.
- [Code style — Logging](../../../../standards/code-style.md#logging) — fixes the `microcompact.cleared` structured event shape.
- [Code style — Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw) — governs the suite layout that asserts invariants without real network.
- [Best practices — Core Principles](../../../../standards/best-practices.md#core-principles) — purity, single responsibility, observability.
- [compact.md §5 Microcompaction](../../../../srs/compact.md#5-layer-1-microcompaction), [§14 Message Grouping](../../../../srs/compact.md#14-message-grouping), and [§15 API Invariant Preservation](../../../../srs/compact.md#15-api-invariant-preservation) are the authoritative external spec — compactable-tool list, clearing marker string, `keepRecent` default, pairing rule, thinking-block continuity rule are not restated here.

## Open questions

- **Leo's compactable-tool mapping**: [compact.md §5](../../../../srs/compact.md#5-layer-1-microcompaction) lists Claude-Code tool names (`FileRead`, `Bash`, `Grep`, `Glob`, `WebSearch`, `WebFetch`, `FileEdit`, `FileWrite`). Leo has `read_note`, `edit_note`, `create_note`, `append_to_note`, `search_vault`. Should `edit_note` / `create_note` / `append_to_note` be eligible for clearing given they're write tools (upstream `FileEdit` / `FileWrite` are)? Or is clearing write-tool results unsafe in Leo because the user may scroll back to inspect applied edits? Proposing write-tool inclusion to match upstream; verifier to confirm.
- **MCP read-tool opt-in**: MCP tools come from arbitrary servers; should MCP tool results be eligible for clearing by default, opt-in via a `ToolSpec.compactable?: boolean` flag, or never? Affects [F51+](../../features-index.md) wiring. Proposing opt-in flag default `false`.
- **Gap measurement basis**: [compact.md §5 Path A](../../../../srs/compact.md#5-layer-1-microcompaction) says "Gap since last assistant message exceeds `gapThresholdMinutes`" — is this wall-clock time from the last assistant message's timestamp, or time since the in-memory message was received? In Obsidian the plugin may be reloaded between turns; does a reload reset the gap? Pick a deterministic rule and pin it in fixtures.
- **`gapThresholdMinutes` / `keepRecent` configurability**: upstream sources these from the `tengu_slate_heron` remote flag. Leo has no remote config; should these be fixed defaults (60 / 5), user-configurable via the Settings tab's Advanced section, or both? Proposing fixed defaults for v1, Advanced-section overrides later.
- **Interaction with F07's streaming mid-turn**: if a turn is mid-stream (partial assistant message with `usage` not yet seen) and the next `AgentRunner.send` fires microcompact, does the in-flight partial message count toward `message.id` grouping, or is it excluded until the stream finalizes? Matters for the thinking-continuity AC; proposing "exclude the in-flight tail" and verifier to confirm.
- **Boundary-marker placement when `tokensSaved === 0`**: AC8 says return `null` (no boundary inserted) in that case, but F46 post-boundary filter logic may still want a "microcompact ran, no savings" signal for telemetry. Confirm with F46 author before wiring.
- **Relationship to `FR-AGENT-08` pre-compaction fallback**: [F10](../agent-controller-core/feature.md) ships a pre-compaction truncator (oldest history → RAG) that also runs pre-API. Execution order with microcompact — does microcompact run before or after the truncator? Proposing microcompact first (matches [compact.md §1](../../../../srs/compact.md#1-overview) "history snip → microcompact"), but F10's `Truncator` is framed as the pre-compaction fallback, not a history-snip. Document the chosen order in the [F10](../agent-controller-core/feature.md) follow-up row once F42 lands.
