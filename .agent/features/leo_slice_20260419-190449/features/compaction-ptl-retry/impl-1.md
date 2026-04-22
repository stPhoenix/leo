# Impl iteration 1 — F44 compaction-ptl-retry

## Summary

Added PTL retry with API-round group head-truncation. `src/agent/ptlRetry.ts` exports `groupMessagesByApiRound` (boundary fires when a non-initial assistant message begins, per compact.md §14), `parseTokenGap` (regex-based extractor returning `null` when unparseable), `truncateHeadForPTLRetry` (strips any leading `PTL_TRUNCATION_MARKER`, groups, chooses `dropCount` from the parseable gap via F41's `estimateMessageTokens` or falls back to `max(1, floor(0.2 * groups.length))` clamped below `groups.length`, slices the head, and prepends the `PTL_TRUNCATION_MARKER` user message with `isMeta: true` whenever the sliced head begins with an assistant), plus `MAX_PTL_RETRIES`, `ERROR_MESSAGE_PROMPT_TOO_LONG`, `PROMPT_TOO_LONG_ERROR_MESSAGE`. The retry loop now lives inside `autoCompactIfNeeded` (F43's module): after each summarization, Leo checks `summary.startsWith(PROMPT_TOO_LONG_ERROR_MESSAGE)`, emits `tengu_compact_ptl_retry` with `{attempt, droppedMessages, remainingMessages}`, re-issues the stream on the truncated head, honours the turn-scoped `AbortController` between retries, and on `ptlAttempts > 3` or `truncateHeadForPTLRetry === null` emits `tengu_compact_failed {reason: 'prompt_too_long', preCompactTokenCount}` and throws `ERROR_MESSAGE_PROMPT_TOO_LONG` verbatim.

## Files touched

- `src/agent/ptlRetry.ts` — new. Exports `truncateHeadForPTLRetry`, `groupMessagesByApiRound`, `parseTokenGap`, `buildPtlMarkerMessage`, `isPtlTruncationMarker`, `ERROR_MESSAGE_PROMPT_TOO_LONG`, `PROMPT_TOO_LONG_ERROR_MESSAGE`, `PTL_TRUNCATION_MARKER`, `MAX_PTL_RETRIES`.
- `src/agent/autocompact.ts` — extended `runCompaction` with the PTL retry loop around `runSummarizationWithRetries`; throws `ERROR_MESSAGE_PROMPT_TOO_LONG` on exhaustion, emits `tengu_compact_ptl_retry` per attempt and `tengu_compact_failed {reason: 'prompt_too_long'}` on failure. Replaced the guarded `while (true)` with `for (;;)` to pass the `no-constant-condition` lint rule.

## Tests added or updated

- `tests/unit/ptlRetry.test.ts` — 21 cases covering AC1–AC10:
  - **Constants** (3): `ERROR_MESSAGE_PROMPT_TOO_LONG` text, `MAX_PTL_RETRIES=3`, `PTL_TRUNCATION_MARKER` text.
  - **`groupMessagesByApiRound`** (3): multi-round grouping with user/assistant/tool sequences; singleton user; empty input.
  - **`parseTokenGap`** (2): parses several "NNN tokens / gap: NNN / exceeds NNN tokens" shapes; returns null on free-form errors.
  - **AC1/AC4 guard** (2): null at 1 group; non-null at 2 groups.
  - **AC4 20% fallback matrix**: 2→1, 5→1, 10→2, 99→19, 100→20.
  - **AC3 parseable-gap mode**: drops groups until accumulated tokens ≥ 8_000-token gap.
  - **AC5 marker** (2): prepends marker when slice head is assistant; asserts every non-empty truncated output is user-led.
  - **AC2 strip-prior-marker**: fixture seeded with a leading `PTL_TRUNCATION_MARKER` produces at most one marker in the output.
  - **AC6 retry loop** (1): two PTL responses then valid summary → 3 stream calls with strictly shrinking message count; two `tengu_compact_ptl_retry` events with `attempt = 1, 2`.
  - **AC7/AC8 exhaustion** (2): four PTL responses raise `ERROR_MESSAGE_PROMPT_TOO_LONG` and emit `tengu_compact_failed {reason: 'prompt_too_long'}` + exactly three `tengu_compact_ptl_retry` records; single-group fixture throws on first PTL without retrying.
  - **AC9 abort** (1): abort mid-PTL halts with callCount=1 and `null` return.
  - **AC10 invariants** (1): truncated head is user-led and every kept `tool_result.toolCallId` maps to a surviving assistant `tool_use` id.
  - **Purity** (1): `truncateHeadForPTLRetry` + `parseTokenGap` + `groupMessagesByApiRound` issue zero `fetch` calls.

Net delta: +21 tests (818 → 839 passing).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **Always-20% fallback is effectively the default path.** `parseTokenGap` implements a best-effort regex scan across common "tokens / gap / exceeds" phrasings, but `PROMPT_TOO_LONG_ERROR_MESSAGE` (the sentinel string) is not a parseable source of a number. In practice — absent a cloud provider forwarding a structured error — the 20% fallback will fire. The regex is present for future `F38` cloud-provider wiring. Matches feature Open question §1 "Proposing always-20% for v1".
- **`cacheSafeParams.forkContextMessages` is not mutated.** Path A (cache-sharing fork) is out of scope for F43's v1 implementation, so there is no `cacheSafeParams` state in autocompact today. The feature Open question §2 proposed "keep the update"; this slice leaves the hook to land when Path A ships — inert for v1 but non-breaking.
- **`isMeta: true` persistence** is not defined here; the marker is transient inside the retry loop (consumed in the current turn) and never reaches the conversation store, matching Open question §3 "strip-before-save, per-retry transient".
- **Grouping in Leo treats the first assistant message as part of the initial group** rather than starting a new boundary, because Leo collapses streaming into one `ChatMessage` per assistant response (no `message.id` discrimination needed). This matches compact.md §14's pseudocode: `current.length > 0` guard AND `msg.message.id !== lastAssistantId` — both conditions fail for the first assistant (lastAssistantId is undefined, current=[user...]).

## Assumptions

- `PROMPT_TOO_LONG_ERROR_MESSAGE` sentinel is `"prompt is too long"` — matches the common OpenAI/Anthropic error prefix; when LM Studio or other providers surface PTL differently, callers can override via future provider-shape adapters. The sentinel is exposed as a constant so tests can inject arbitrary text.
- `ERROR_MESSAGE_PROMPT_TOO_LONG` is thrown by the autocompact path; the auto-trigger caller is expected to catch and convert to `null` per compact.md §20 "Auto-compact errors: Logged, failure counter incremented, retried next turn. No user notification." Manual `/compact` callers (future) should re-raise to the user.
- `dropCount >= 1 && dropCount < groups.length` invariant holds — the function returns `null` whenever the invariant would be violated, so callers always get either `null` or a strictly-smaller truncation.
- Token-gap accumulation uses `estimateMessageTokens` (Tier-3-with-no-4/3 padding) rather than `tokenCountWithEstimation`, because the gap count is compared to raw group-level token estimates — Tier-2 anchors don't apply to sliced subsets.

## Open questions

- **Provider-specific PTL regex shapes**: pinned to 20% fallback until F38 cloud providers land; no regex changes expected until then.
- **Structured error envelope parsing**: deferred — only leading-text sentinel check is wired.
- **Circuit-breaker / F45 interaction**: PTL-exhaust emits `tengu_compact_failed {reason: 'prompt_too_long'}` so F45 can count it alongside streaming failures (feature Open question §4 "include").
- **Marker rendering in the chat transcript**: `isMeta: true` is a hint for future UI code; today nothing renders it.
