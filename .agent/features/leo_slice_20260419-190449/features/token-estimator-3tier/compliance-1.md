# Compliance iteration 1 — F41 token-estimator-3tier

## Acceptance criteria

- AC1: PASS — `estimateTokens` at `src/agent/tokenEstimator.ts:113-123` applies the 3-tier priority: checks tail for assistant-with-usage (Tier 1), else tries `tokenCountWithEstimation` (Tier 2), else falls through to `estimateMessageTokens + applyPadding` (Tier 3). Asserted by `tests/unit/tokenEstimator.test.ts` "picks tier 1 when latest message is assistant with usage" + "picks tier 2 when earlier assistant usage exists and messages appended since" + "picks tier 3 when no prior usage exists anywhere".
- AC2: PASS — `apiUsageTokens` at `:82-98` returns input+output (or `total_tokens` override) verbatim from the latest assistant with usage, no multiplier. Asserted by "returns total from latest assistant usage", "honours provided total_tokens when present", "returns null when no assistant usage", "returns null when latest assistant has no usage (does not walk further back)".
- AC3: PASS — `tokenCountWithEstimation` at `:100-112` walks backwards for the last assistant `usage.input_tokens`, uses it as base, adds `estimateMessageTokens` over the slice after the anchor, returns `applyPadding(base + delta)`. Asserted by "uses last usage.input_tokens as base + estimates blocks appended since" (base=100 + delta=3 → padded 137), "returns null when no prior usage exists anywhere", "works when no new messages have been appended since the last usage".
- AC4: PASS — `roughTokenCountEstimation(content, bytesPerToken = 4)` at `:29-32` returns `Math.round(content.length / bytesPerToken)` with default 4. Asserted by 5 boundary cases: empty (0), single-char (0), 4-char (1), 5-char (1), custom bytesPerToken=2 (6/2=3).
- AC5: PASS — `estimateBlockTokens` at `:34-62` implements every per-block rule from compact.md §4: text → rough, image/document → 2000, tool_result → sum of nested, thinking → rough on `thinking` string, tool_use → rough on `name + JSON(input)`, other/server_tool_use → rough on `JSON(block)`. Asserted by 7 dedicated cases.
- AC6: PASS — `applyPadding(raw)` at `:77-79` multiplies by `CONSERVATIVE_MULTIPLIER = 4/3` and rounds; invoked from `tokenCountWithEstimation` (Tier 2) and `estimateTokens`'s Tier 3 branch. Tier 1 (`apiUsageTokens`) returns verbatim without padding. Asserted by "tier 1 result is NOT multiplied by 4/3 (authoritative passthrough)" + "tier 3 applies the 4/3 multiplier to the rough sum".
- AC7: PASS — Module imports nothing from `obsidian`/`react`/any adapter; zero DOM/FS access. All functions are deterministic over their inputs. Asserted by "identical input produces identical output (purity)".
- AC8: PASS — Vitest suite totals 26 cases: Tier 1 passthrough (4 cases), Tier 2 base+delta + no-prior-usage + no-delta-since (3 cases), Tier 3 boundaries (5 cases), per-block rules (7 cases), orchestrator tier-selection + multiplier rules (6 cases), string-content handling (1 case).

## Scope coverage

- In scope "Three named tier entry points + `estimateTokens` orchestrator": PASS.
- In scope "Per-block rules from compact.md §4": PASS — all six block categories covered.
- In scope "4/3 conservative multiplier at the total step": PASS — applied at Tier 2 and Tier 3, exempted at Tier 1.
- In scope "Tier 2 backward-walk with mid-stream support": PASS.
- In scope "Tier 1 wiring to StreamEvent.usage payload shape": PASS — `TokenUsage.{input_tokens, output_tokens, total_tokens?}` matches OpenAI + Anthropic common shape.
- In scope "Pure-module boundary": PASS.
- In scope "Vitest coverage for every tier / block / boundary": PASS.

## Out-of-scope audit

- Out of scope "Microcompaction + tool_result clearing": CLEAN.
- Out of scope "Autocompaction thresholds + summarization + post-compact assembly": CLEAN.
- Out of scope "PTL retry + circuit breaker": CLEAN.
- Out of scope "ContextAnalyzer pipeline + /context UI": CLEAN.
- Out of scope "F12 token-usage-indicator integration": CLEAN — F12 still uses the existing `tokenCount.ts` fallback; consumers will migrate in their respective slices.

## QA aggregate
Verdict: PASS — typecheck / lint / 752-tests / build all green.

## Verdict: PASS (rounding policy pinned to `Math.round`, tail-must-carry-usage rule pinned for Tier 1 — both are deterministic picks from feature Open questions §2/§3 and will be honoured by F42–F48 consumers)
