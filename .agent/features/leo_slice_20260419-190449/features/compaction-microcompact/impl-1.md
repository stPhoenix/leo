# Impl iteration 1 — F42 compaction-microcompact

## Summary

Added pure module `src/agent/microcompact.ts` with `microcompactMessages(messages, ctx?, querySource?)` implementing compact.md §5 Path A: time-gap gating against the last assistant timestamp, FIFO collection of compactable `tool_use` ids in order, `keepRecent` retention (default 5, min 1), replacement of older `tool_result.content` with the literal marker `[Old tool result content cleared]`, insertion of a `SystemMicrocompactBoundaryMessage` at the first cleared tool_result position, token-saved computation via a CompactMessage-aware estimator that reuses F41's `roughTokenCountEstimation` + `IMAGE_DOCUMENT_TOKENS`, structured `microcompact.cleared` log emission, and null-return on zero savings or any gate miss. AgentRunner wires the pass between `ContextAssembler.assemble` + `truncate` and every `provider.stream()` round-trip via `applyMicrocompactPass`, preserving message ordering and rewriting cleared tool_result ChatMessage content in place. Built-in compactable allowlist = `read_note`, `edit_note`, `create_note`, `append_to_note`, `search_vault`; MCP opt-in is available through `ctx.isCompactable` (defaulting to builtin set).

## Files touched

- `src/agent/microcompact.ts` — new pure module. Exports `microcompactMessages`, `CompactMessage` / `CompactToolCallRef` / `CompactContentBlock` / `SystemMicrocompactBoundaryMessage` types, `createMicrocompactBoundary`, `isMicrocompactBoundary`, `estimateCompactTokens`, `CLEARED_CONTENT_MARKER`, `MICROCOMPACT_BOUNDARY_MARKER`, `DEFAULT_GAP_THRESHOLD_MINUTES` (60), `DEFAULT_KEEP_RECENT` (5), `BUILTIN_COMPACTABLE_TOOLS`.
- `src/agent/agentRunner.ts` — added `MicrocompactAgentOptions` on `AgentRunnerOptions`, stored config on the runner, added `applyMicrocompactPass` + `defaultIsCompactable` + `toCompactMessages` / `fromCompactMessages` adapters, tracked `workingTimestamps` in parallel with `workingMessages`, and called the pass at the start of every tool-call round-trip iteration before `provider.stream`. Pass defaults to enabled; returns unmodified working state whenever microcompactMessages returns null.

## Tests added or updated

- `tests/unit/microcompact.test.ts` — 23 cases covering AC1–AC6, AC8, AC9:
  - **allowlist**: `BUILTIN_COMPACTABLE_TOOLS` exact contents (AC4).
  - **gating**: returns null with no assistant timestamp / gap below threshold / no compactable tools / all uses within `keepRecent` (AC5, AC8).
  - **clearing**: default threshold + keepRecent=5 clears the oldest 2 of 7 and keeps the last 5 in order (AC5); custom keepRecent=2 clears first 3 and retains payloads verbatim; keepRecent=0 clamps to 1 (AC5); non-compactable tool_results (`TodoWrite`) pass through untouched while interleaved `read_note` round-trips clear (AC4); `ctx.isCompactable` opt-in route enables MCP names (AC4).
  - **pairing invariant**: every kept `tool_result.toolCallId` maps to a surviving assistant `tool_use` id (AC2); non-`tool_result` messages stay byte-identical (AC6).
  - **streaming-chunk adjacency**: two assistant messages sharing `messageId='m-1'` + `'m-2'` stay adjacent (delta = 1) in the returned list; neither pair is split by the boundary (AC3).
  - **boundary marker**: `SystemMicrocompactBoundaryMessage` inserted directly before the first cleared `tool_result`; `createMicrocompactBoundary` + `isMicrocompactBoundary` detection (AC8).
  - **tokensSaved + null return**: null when the replacement marker is not shorter than cleared content (AC8); positive savings when real 400-byte payloads are cleared (AC9).
  - **logger event**: emits `microcompact.cleared` with `{gapMinutes, toolsCleared, toolsKept, keepRecent, tokensSaved, querySource}` (AC9); no emission when returning null.
  - **no-LLM + purity**: spy asserts `fetch` is never called on the full matrix (AC1); two identical calls return structurally equal output.
  - **estimator**: `estimateCompactTokens` returns expected rough len/4 counts on string content and tool_use blocks via `name + JSON(input)`.
- `tests/unit/agentRunner.microcompact.test.ts` — 2 integration cases for AC7:
  - Sequenced provider drives 7 compactable `read_note` round-trips under a controllable clock (10-min tick, `gapThresholdMinutes: 15`, `keepRecent: 2`); asserts the final `provider.stream` call carries the microcompacted `ChatMessage[]` with older tool_result contents replaced by `[Old tool result content cleared]` and `microcompact.cleared` records present in the sink (toolsCleared > 0, keepRecent = 2).
  - No-gap case (single-second tick advance) asserts no `microcompact.cleared` emission and no cleared markers in any provider call — ensures the pass is inert inside its gap window.

Net delta: +25 tests (752 → 777 passing).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **MCP compactable opt-in is callback-based, not a `ToolSpec.compactable` flag.** Feature Open question §2 proposed a `ToolSpec.compactable?: boolean` flag defaulting `false`. Implementation exposes `ctx.isCompactable(name)` so callers choose; `AgentRunner.defaultIsCompactable` first checks `BUILTIN_COMPACTABLE_TOOLS`, then reads an optional `compactable` property on the registry spec as an escape hatch, so a future `ToolSpec.compactable` addition (when the MCP slice lands) will light up without another microcompact change. No production `ToolSpec` currently sets it, so behaviour is identical to the proposed default.
- **Boundary marker is filtered out when emitting `ChatMessage[]` to the provider.** F46 is unbuilt, so AgentRunner's `fromCompactMessages` drops boundary messages before they reach `provider.stream`. The boundary is still present in the pure-module output (AC8) and is easy to preserve for F46 wiring later.
- **Token-saved estimator uses a CompactMessage-aware pass**, not F41's `estimateMessageTokens(TokenMessage[])` directly, because CompactMessage's shape diverges from TokenMessage (it carries `toolCalls` + `tool_use_id`). The helper reuses F41's per-block primitives (`roughTokenCountEstimation`, `IMAGE_DOCUMENT_TOKENS`) so the numbers line up with the 3-tier estimator.

## Assumptions

- Gap-measurement basis (feature Open question §3): wall-clock `now - lastAssistantTimestamp` based on the latest timestamp attached to any assistant in the in-memory list; reloads do not reset (F14 persists the list without synthesising new timestamps). If every assistant lacks a timestamp the pass is inert (null return) — matches "deterministic rule" request.
- `gapThresholdMinutes` and `keepRecent` ship as code defaults (60 / 5), overridable via `AgentRunnerOptions.microcompact` and `MicrocompactContext`; no Settings-tab surface (Open question §4).
- Mid-stream assistant tails are excluded because the pass runs before `provider.stream`; the round-trip loop always reaches a synchronization point before re-entering the pass (Open question §5).
- Pre-compaction/truncator ordering (Open question §7): microcompact runs AFTER `truncate` and BEFORE `provider.stream`, i.e. truncation-as-budget-guard is applied once during assembly, then microcompact clears tool_result content each round. Matches compact.md §1 "history snip → microcompact".

## Open questions

- **F46 boundary consumption**: whether the boundary marker should travel on the wire (role='system') or live purely in-memory — deferred to F46. Current wiring strips it pre-provider; easy to flip.
- **MCP tool `compactable` flag**: codifying the opt-in via `ToolSpec.compactable?: boolean` is straightforward when F51+ lands. Keeping the callback-based design for now avoids changing `ToolSpec` before an MCP tool actually ships.
- **F43 autocompact interaction**: the compact.md §1 order has microcompact running before full-history summarization, which F43 will own. F42 exposes the boundary marker and `tokensSaved` so F43 can short-circuit summarization when microcompact already saved enough.
