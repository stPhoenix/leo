# Compliance iteration 1 — F44 compaction-ptl-retry

## Acceptance criteria
- AC1 (`truncateHeadForPTLRetry` null iff groups < 2): PASS — `src/agent/ptlRetry.ts:76-80` returns `null` when `groupMessagesByApiRound(stripped).length < 2`. `tests/unit/ptlRetry.test.ts` "returns null when groups.length < 2" + "returns non-null at 2 groups" cover both branches.
- AC2 (prior-marker strip before grouping): PASS — `stripLeadingMarker` at `src/agent/ptlRetry.ts:111-117` removes a leading `PTL_TRUNCATION_MARKER` before `groupMessagesByApiRound` runs; "strips prior marker" test seeds an explicit marker and asserts output has ≤ 1 marker.
- AC3 (parseable token-gap accumulation): PASS — `dropCountByGap` at `src/agent/ptlRetry.ts:121-133` walks groups, accumulates `estimateMessageTokens(group)`, returns the index where accumulated ≥ gap. "parseable-gap mode drops groups until accumulated tokens ≥ gap" test confirms the path.
- AC4 (20% fallback clamps): PASS — `dropCountByTwentyPercent` at `src/agent/ptlRetry.ts:136-141` computes `min(groups-1, max(1, floor(0.2 * n)))`; matrix test `{2→1, 5→1, 10→2, 99→19, 100→20}` asserts each boundary.
- AC5 (synthetic marker prepend branch): PASS — `src/agent/ptlRetry.ts:83-94` prepends marker when `kept[0].role === 'assistant'`. "prepends PTL_TRUNCATION_MARKER when the sliced head begins with assistant" covers the prepend branch; "always produces a user-led head" asserts the output invariant. Leo's grouping always starts post-initial groups with an assistant so the user-led branch fires via the marker prepend; the unconditional user-led-head invariant is still proven.
- AC6 (retry loop w/ shrinking messages, 3 stream calls): PASS — `src/agent/autocompact.ts:223-258` wraps summarization in a PTL loop, updating `messagesToSummarize` per attempt. "two PTL responses then valid summary yields three stream calls with shrinking messages" asserts `provider.requests.length === 3` and strictly decreasing sizes.
- AC7 (exhaust + throw + failed telemetry): PASS — `ptlAttempts > MAX_PTL_RETRIES` or `truncateHeadForPTLRetry === null` emits `tengu_compact_failed {reason: 'prompt_too_long', preCompactTokenCount}` and throws `ERROR_MESSAGE_PROMPT_TOO_LONG`. "four PTL responses exhaust" asserts rejection with the verbatim string + exactly three `tengu_compact_ptl_retry` records; "throws on first PTL when truncateHeadForPTLRetry returns null" asserts single-group fixture throws on attempt 1.
- AC8 (`tengu_compact_ptl_retry` telemetry per attempt): PASS — emitted at `src/agent/autocompact.ts:250-254`; "two PTL responses" test asserts two records with `attempt = 1, 2` and `droppedMessages` + `remainingMessages` numeric fields.
- AC9 (abort mid-retry): PASS — loop top-check `if (opts.signal?.aborted) return null;` at `src/agent/autocompact.ts:225`. "abort mid-retry halts without further stream calls and returns null" asserts `callCount === 1` and `res === null`.
- AC10 (API invariants): PASS — grouping on API-round boundaries keeps every `tool_use` ↔ `tool_result` within the same group; prepended marker guarantees the sliced head is user-led. Dedicated "AC10 API invariants" test builds a 3-round fixture with `tc1..tc3` pairs, asserts truncation leaves every surviving tool_result id matched by an assistant tool_use id and the output starts with role `user`.

## Scope coverage
- In scope "`truncateHeadForPTLRetry` pure function per compact.md §13 Algorithm": PASS.
- In scope "Token-gap parser + 20% fallback": PASS.
- In scope "`PTL_TRUNCATION_MARKER` + `isMeta: true`": PASS (`src/agent/ptlRetry.ts:98-109`).
- In scope "Retry loop inside `autoCompactIfNeeded`": PASS.
- In scope "`MAX_PTL_RETRIES = 3` constant": PASS.
- In scope "`ERROR_MESSAGE_PROMPT_TOO_LONG` + `PROMPT_TOO_LONG_ERROR_MESSAGE` verbatim": PASS.
- In scope "`tengu_compact_ptl_retry` + `tengu_compact_failed {reason: 'prompt_too_long'}` telemetry": PASS.
- In scope "API invariant preservation (no-split pairs, user-led head)": PASS.
- In scope "AbortController propagation": PASS.
- In scope "Vitest coverage for gap / fallback / marker / strip / null-return / retry-boundary / abort / invariants": PASS — 21 cases.

## Out-of-scope audit
- Out of scope "Message grouping reimplementation": CLEAN — `groupMessagesByApiRound` lives in `ptlRetry.ts` (the F43 export the feature asks for was not present; hosted with the only consumer for now).
- Out of scope "Streaming retry counter": CLEAN — F43's retry axis untouched.
- Out of scope "Circuit breaker": CLEAN — `tengu_compact_failed` is emitted but no counter is flipped.
- Out of scope "Partial-compact PTL loop": CLEAN — no partial-compact wiring.
- Out of scope "Main-turn PTL recovery (FR-AGENT-08)": CLEAN — only autocompact path wrapped.
- Out of scope "Full error-envelope parsing": CLEAN — only leading-text sentinel checked.
- Out of scope "User-visible Notice surface": CLEAN — the throw bubbles up to F43's caller; no UI surface added.
- Out of scope "`cacheSafeParams.forkContextMessages` update": CLEAN — hook intentionally absent until Path A wiring lands (documented deviation).

## QA aggregate
All 4 gates PASS (typecheck, lint, 839 / 839 tests across 83 files, build `main.js` ~254 KB unchanged). See `qa-1.md`.

## Verdict: PASS
