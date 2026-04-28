# F41 — Token estimator (3-tier)

## Purpose

Deliver the shared 3-tier token estimator that every downstream compaction and `/context` feature depends on: Tier 1 reads authoritative `usage` counts from the provider terminal stream surfaced by [F07](../chat-streaming-stop/feature.md), Tier 2 walks the message list backwards to the last `usage`-bearing assistant response and estimates only the delta added since, and Tier 3 falls back to a rough `roughTokenCountEstimation(content, 4)` (i.e. `Math.round(content.length / 4)`) when neither is available, with per-block rules and the final 4/3 conservative multiplier defined in [compact.md §4](../../../../srs/compact.md#4-token-counting) and asserted by the Vitest suite required by [NFR-TEST-06](../../context.md#nfr-test-06). This is a pure estimator module (no side effects, no UI) that satisfies [FR-COMPACT-02](../../context.md#fr-compact-02) and is consumed by F42 microcompaction, F43 autocompaction, F44 PTL retry, F46 ContextAnalyzer, and the F12 token-usage-indicator fallback path.

## Scope

### In scope

- Three named tier entry points exposed from a single `tokenEstimator` module: `apiUsageTokens(messages)` (Tier 1), `tokenCountWithEstimation(messages)` (Tier 2), and `roughTokenCountEstimation(content, bytesPerToken = 4)` (Tier 3), with a public `estimateTokens(messages)` orchestrator that applies the 3-tier priority `usage > hybrid > len/4`.
- Per-block rules for `estimateMessageTokens(messages)` per [compact.md §4](../../../../srs/compact.md#4-token-counting): `text`, `image`/`document`, `tool_result`, `thinking`, `tool_use`, and other blocks; estimator returns a single integer token count.
- Final conservative padding step: the total returned by `estimateMessageTokens` / `tokenCountWithEstimation` is multiplied by `4/3` before being returned to callers.
- Tier 2 hybrid path: walk messages backwards for the last assistant response carrying `usage.input_tokens`; use that count as the base and add `estimateMessageTokens` over the blocks appended since that response; works mid-stream.
- Tier 1 wiring to the `StreamEvent.usage` / `done` payload surfaced by [F07](../chat-streaming-stop/feature.md) (OpenAI-compatible `{prompt_tokens, completion_tokens, total_tokens}`); estimator records this verbatim on the terminal message so Tier 2 can reuse it on the next turn.
- Pure-module boundary: no IO, no React, no Obsidian API dependence; deterministic for identical inputs so the Vitest suite required by [NFR-TEST-06](../../context.md#nfr-test-06) can golden-assert outputs.
- Vitest coverage for every tier, per-block rule, the 4/3 multiplier, the Tier 2 backward walk (including "no prior usage" falling through to Tier 3), and integer-rounding / empty-input / single-char / 4-char / 5-char boundaries.

### Out of scope

- Microcompaction, tool-result clearing, and `tool_use` ↔ `tool_result` pairing preservation — ship with F42.
- Autocompaction threshold evaluation, constants from compact.md §3, summarization prompt, post-compact assembly — ship with F43.
- Prompt-too-long group head-truncation retry — ships with F44.
- Circuit breaker for repeated autocompact failures — ships with F45.
- ContextAnalyzer pipeline and seven-parallel counting ops — ship with F46.
- `/context` UI, grid, suggestions, status line — ship with F47 / F48.
- Updating the F12 token-usage-indicator to prefer this estimator over its local `len/4` fallback — handled in the F12 follow-up row once F41 lands.

## Acceptance criteria

1. `estimateTokens(messages)` applies the 3-tier priority **usage > hybrid > len/4**: Tier 1 is chosen whenever the most recent assistant message carries a provider `usage` payload; Tier 2 is chosen whenever any earlier assistant message carries `usage.input_tokens` and new blocks have been appended since; Tier 3 is chosen only when no prior `usage` is available anywhere in the message list. (FR-COMPACT-02)
2. Tier 1 `apiUsageTokens(messages)` returns the `usage` counts from the latest provider response verbatim (no multiplier, no padding) — authoritative per [compact.md §4](../../../../srs/compact.md#4-token-counting) Tier 1. (FR-COMPACT-02)
3. Tier 2 `tokenCountWithEstimation(messages)` walks messages backwards to the last response with `usage.input_tokens`, uses that as the base, adds `estimateMessageTokens` over blocks appended since that response, and returns the sum; works during streaming (i.e. when the trailing assistant message is still being produced). (FR-COMPACT-02)
4. Tier 3 `roughTokenCountEstimation(content, bytesPerToken = 4)` returns `Math.round(content.length / bytesPerToken)`; default `bytesPerToken` is 4. (FR-COMPACT-02)
5. `estimateMessageTokens(messages)` applies the per-block rules defined in [compact.md §4](../../../../srs/compact.md#4-token-counting) (text, image/document, tool_result, thinking, tool_use, other) without restatement; the Vitest suite asserts the exact numeric output for one fixture per block kind. (FR-COMPACT-02, NFR-TEST-06)
6. After `estimateMessageTokens` or `tokenCountWithEstimation` produces a total, the estimator multiplies it by **4/3** before returning; Tier 1 (authoritative `usage`) is exempt from this multiplier. (FR-COMPACT-02)
7. The module is pure: identical input returns identical output across calls; no imports from `obsidian`, `react`, or any adapter; Vitest runs the suite without mocks for DOM or filesystem per [NFR-TEST-06](../../context.md#nfr-test-06). (NFR-TEST-06)
8. Vitest coverage asserts: Tier 1 passthrough, Tier 2 backward-walk with base + delta, Tier 2 fallthrough to Tier 3 when no prior `usage` exists, Tier 3 `len/4` rounding at empty / single-char / 4-char / 5-char boundaries, per-block rules for every block kind (text, image, document, tool_result with nested items, thinking, tool_use, server_tool_use), and the 4/3 multiplier applied to hybrid and rough totals but not to Tier 1. (NFR-TEST-06)

## Dependencies

- [F07 chat-streaming-stop](../chat-streaming-stop/feature.md) — supplies the terminal `StreamEvent.usage` / `done` payload that feeds Tier 1 and seeds Tier 2's backward walk.
- Drives requirements [FR-COMPACT-02](../../context.md#fr-compact-02) and [NFR-TEST-06](../../context.md#nfr-test-06).

## Implementation notes

- [Architecture §3.2 Agent Layer](../../../../architecture/architecture.md#32-agent-layer) — estimator lives alongside `AgentRunner` / `Truncator` as a pure helper.
- [Architecture §3.3 Domain / Core (pure)](../../../../architecture/architecture.md#33-domain--core-pure) — fits the "pure input → number" contract used by `Scorer` and `Truncator`.
- [Architecture §4 Key Contracts](../../../../architecture/architecture.md#4-key-contracts) — `StreamEvent.usage` shape is the Tier 1 source.
- [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) — pure module has no lifecycle; callers own their `AbortController`.
- [Tech stack — Agent Layer](../../../../standards/tech-stack.md#agent-layer) pins the pure-TS runtime this module targets.
- [Code style — TypeScript](../../../../standards/code-style.md#typescript) and [Async & Concurrency](../../../../standards/code-style.md#async--concurrency) govern the module's synchronous, side-effect-free surface.
- [Code style — Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw) governs the NFR-TEST-06 suite layout.
- [Best practices — Core Principles](../../../../standards/best-practices.md#core-principles) — purity, deterministic output, single responsibility.
- [compact.md §4 Token Counting](../../../../srs/compact.md#4-token-counting) is the authoritative external source for per-block rules, the `bytesPerToken = 4` default, the backward-walk definition of Tier 2, and the final 4/3 multiplier — rules are not restated here.

## Open questions

- **Tier 1 exemption from the 4/3 multiplier**: [compact.md §4](../../../../srs/compact.md#4-token-counting) states the multiplier at the end of the Message-Level Estimation section; it is not explicit whether Tier 1 (authoritative `usage`) should also be padded. AC6 assumes no (the multiplier is estimation padding, not authoritative-count padding). Confirm before implementation.
- **Tier 2 base selection when multiple `usage`-bearing responses exist**: the spec says "last API response that has `usage.input_tokens`"; does "last" mean most-recent before the tail, or most-recent anywhere including a currently-streaming tail that has already emitted a partial `usage`? Partial mid-stream `usage` is rare but LM Studio may emit it — pick a deterministic rule.
- **Rounding policy for the 4/3 multiplier**: compact.md §4 does not specify `Math.ceil` vs `Math.round` vs `Math.floor` for the conservative padding step. AC6 leaves it open; choose one and pin it in the Vitest fixtures so F42–F48 can depend on a stable number.
- **Block-type coverage beyond the listed ones**: compact.md §4 says "Other blocks (server_tool_use, etc.): `roughTokenCountEstimation(JSON(block))`"; is the fallback keyed on a closed enum of known block types, or does any unknown block fall into this bucket? Affects forward-compat for future provider block kinds.
- **Hybrid base invalidation on compaction boundary**: once autocompaction (F43) inserts a summary + boundary marker, the "last `usage.input_tokens`" walk may cross the boundary and double-count. Does Tier 2 stop at the compaction boundary, or is this handled by F43 re-seeding `usage` on the summary message? Clarify before F43 wires this in.
