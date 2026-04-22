# Impl iteration 1 — F12 token-usage-indicator

## Summary

Added a `TokenUsage` shape on `ChatMessageRecord` and a `len/4` estimator at `src/chat/tokenUsage.ts`. `TurnDispatcher` now wraps the provider `AsyncIterable` in a `trackUsage()` generator that accumulates `token` output chars and captures `usage.input` / `usage.output` when the provider emits them; on terminal exit (done / error / cancel — the generator's `finally` always fires) it writes a `TokenUsage` onto the assistant record via `messageStore.update`. `AssistantBubble` grew a `TokenUsageFooter` rendered under the bubble only when streaming has ended and tokens are captured, showing input / output / total with a `~` prefix on fields the provider didn't supply.

## Files touched

- `src/chat/tokenUsage.ts` — new: `TokenUsage` type, `estimateTokensFromChars` (`Math.ceil(len/4)`, clamps ≤ 0), `computeTokenUsage` merging provider + estimator axes independently.
- `src/chat/types.ts` — added `tokens?: TokenUsage` to `ChatMessageRecord`.
- `src/ui/chat/turnDispatcher.ts` — `trackUsage` generator + `commitUsage` path; also commits a zero-output usage block when the starter is undefined so no-provider test paths still finalize.
- `src/ui/chat/MessageList.tsx` — `AssistantBubble` conditionally renders a `TokenUsageFooter`; new component prints labelled spans with data-slot hooks and an `aria-label="token usage"` on the footer.
- `styles.css` — `.leo-bubble-usage` footer (dashed top border, muted colour, Obsidian vars only); italic on estimated fields.
- `tests/unit/tokenUsage.test.ts` — 11 cases: `len/4` boundaries (0 / 1 / 4 / 5), negative clamp, provider verbatim, provider-absent fallback, mixed input-only / output-only, zero-output error paths.
- `tests/unit/turnDispatcher.test.ts` — 4 new cases: provider-usage commit on done, fallback estimation when usage absent, error path commits tokens from streamed output, cancel path commits tokens after Stop.
- `tests/dom/tokenUsageFooter.test.tsx` — 6 cases: full-usage render, fully-estimated `~`-prefixed render, partial-mix (input verbatim + output estimated), no render while streaming, no render when tokens absent, `aria-label` exposure.

## Tests added or updated

- 11 `tokenUsage`, 4 `turnDispatcher` (usage commits), 6 footer cases. Full suite: 30 files, 250/250 pass.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- Feature mentions `prompt_tokens` / `completion_tokens` / `total_tokens` OpenAI field names; F02's `StreamEvent.usage` already maps those to `{input, output}`. This implementation reads the already-mapped fields. `total_tokens` is never read from the provider — we compute `total = input + output` in `computeTokenUsage`, which matches all observed OpenAI-compatible implementations.
- The `usage` value commits regardless of whether the stream ended with `done`, `error`, or an aborted Stop. The commit fires from a `try { ... } finally { commitUsage }` in `trackUsage`, so the footer appears on all three terminal paths without per-path branching.

## Assumptions

- When the stream emits `usage` mid-turn with only one of `{input, output}` populated (e.g. some providers send the input count early), the second numeric is set to `0` by the provider adapter and the fallback estimator **does not** kick in for that field. This matches F02's current shape where `usage` is a `{input, output}` pair and both are numbers; the adapter is responsible for any upstream partial-field fallback. The mixed-path coverage at the F12 layer is driven by explicitly unset `providerInput` / `providerOutput` at the `computeTokenUsage` boundary.
- Footer visibility is conditioned on `!streaming && tokens !== undefined`. If no tokens are committed (e.g. dispose before any stream event) the footer is simply absent — acceptable per AC4's "every completed-or-terminated assistant message" since dispose means the view / turn was abandoned mid-flight.

## Open questions

None.
