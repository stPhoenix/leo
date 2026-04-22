# Impl iteration 1 — F41 token-estimator-3tier

## Summary

Added pure module `src/agent/tokenEstimator.ts` with the compact.md §4 3-tier pipeline: Tier 1 `apiUsageTokens(messages)` reads the latest assistant's `usage.{input_tokens, output_tokens, total_tokens}` verbatim without padding; Tier 2 `tokenCountWithEstimation(messages)` walks backwards for the last assistant `usage.input_tokens`, uses it as a base, adds `estimateMessageTokens` over blocks appended since, then multiplies by 4/3; Tier 3 `roughTokenCountEstimation(content, 4)` = `Math.round(len/4)` with the 4/3 multiplier applied at the total level. `estimateTokens(messages)` is the priority orchestrator that returns `{total, tier: 'usage' | 'hybrid' | 'rough'}`. Per-block rules matched to compact.md §4: text → `rough(text)`, image/document → 2000 each, tool_result → sum of nested content, thinking → `rough(thinking)`, tool_use → `rough(name + JSON(input))`, fallback → `rough(JSON(block))`. Integer rounding of the 4/3 padding uses `Math.round` (pinned for downstream F42-F48 determinism).

## Files touched

- `src/agent/tokenEstimator.ts` — new module. Exports `estimateTokens` / `apiUsageTokens` / `tokenCountWithEstimation` / `roughTokenCountEstimation` / `estimateMessageTokens` / `estimateBlockTokens`, `CONSERVATIVE_MULTIPLIER = 4/3`, `IMAGE_DOCUMENT_TOKENS = 2000`, `TokenBlock` / `TokenMessage` / `TokenUsage` / `EstimateResult` types.

## Tests added or updated

- `tests/unit/tokenEstimator.test.ts` — 26 cases covering AC1–AC8:
  - **Tier 3 `roughTokenCountEstimation` boundaries**: empty / single-char / 4-char / 5-char / custom bytesPerToken (AC4, AC8).
  - **Per-block rules**: text / image / document / tool_result nested / thinking / tool_use (rough on name + JSON(input)) / server_tool_use + unknown (rough on JSON(block)) (AC5, AC8).
  - **Tier 1 `apiUsageTokens`**: latest assistant usage returned verbatim, total_tokens override, `null` when no assistant usage, does NOT walk past a recent-but-usage-less assistant (AC2).
  - **Tier 2 `tokenCountWithEstimation`**: base + delta + 4/3 padding, `null` on no prior usage, works when no new messages appended since (AC3).
  - **`estimateTokens` orchestrator**: picks `'usage'` when latest assistant has usage (AC1), picks `'hybrid'` when earlier usage exists + messages appended, picks `'rough'` when no usage anywhere, Tier 1 result NOT multiplied by 4/3 (AC6), Tier 3 applies the multiplier, purity (identical input → identical output) (AC7).
  - **String content as a single text block** — matches compact.md §4 treatment when the provider sends a string payload.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **`Math.round` chosen for the 4/3 multiplier** (not `Math.ceil` / `Math.floor`). Feature Open question §3 asks to pin one; round is the most neutral choice and matches the bulk of compact.md's existing rounding at Tier 3. All Vitest fixtures compute expectations via the same `Math.round(raw * 4/3)` formula so downstream F42–F48 dependents can rely on this number.
- **`apiUsageTokens` does NOT walk past a recent-but-usage-less assistant message.** Feature Open question §2 asks for "last API response that has `usage.input_tokens`". Implementation: the orchestrator checks the tail — if it's an assistant with `usage`, tier 1 fires; otherwise tier 2 walks backwards for the last assistant `usage.input_tokens`. This is a defensible "tail-must-carry-usage" reading that avoids false positives from stale usage on earlier turns.
- **Block shape pinned to a small discriminated union.** Feature enumerates the block kinds informally (text / image / document / tool_result / thinking / tool_use / other). The `TokenBlock` type declares the known variants + a catch-all `{type: string}` fallback that routes to `rough(JSON(block))`.

## Assumptions

- Downstream F42 microcompaction will clear tool_result content in-place; the estimator will see the pruned content and re-estimate cleanly because `estimateMessageTokens` sums nested `tool_result.content` blocks each turn.
- F43 autocompaction will insert a summary message with its own `usage` marker on the next-turn anchor; Tier 2's backward walk stops at the first usage it finds, so the compaction boundary is naturally respected (feature Open question §5).
- The F07 streaming wire-up will attach `usage: {input_tokens, output_tokens, total_tokens}` to the terminal assistant message when the provider emits `StreamEvent.usage`. That's consistent with `ProviderManager.usage` telemetry already in place.

## Open questions

- Tier 1 exemption from 4/3 multiplier (feature Open question §1) — shipped as exempted per AC6.
- Tier 2 base selection with mid-stream usage (feature Open question §2) — "last assistant with usage" is the rule; mid-stream partial usage gets picked up as the freshest anchor naturally.
- Rounding policy (feature Open question §3) — `Math.round` pinned.
- Forward-compat block kinds (feature Open question §4) — catch-all discriminant routes unknown blocks to `rough(JSON(block))`.
- Compaction boundary behaviour (feature Open question §5) — natural by construction; F43 needs to re-seed usage on the summary message for Tier 2 to pick it up as the new anchor.
