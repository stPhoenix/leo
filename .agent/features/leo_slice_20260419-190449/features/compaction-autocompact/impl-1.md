# Impl iteration 1 — F43 compaction-autocompact

## Summary

Added the Layer-2 autocompaction engine across three modules: `src/agent/compactConstants.ts` pins every §3 constant + `resolveContextWindow` (priority `[1m]` suffix → provider capability → 200 000 default) + `autoCompactThresholdFor`, `src/agent/compactPrompts.ts` carries verbatim `NO_TOOLS_PREAMBLE`, `BASE_COMPACT_PROMPT`, `DETAILED_ANALYSIS_INSTRUCTION`, `NO_TOOLS_TRAILER`, and the compact system prompt plus `getCompactPrompt(customInstructions?)` that concatenates them per the §10 formula, and `src/agent/autocompact.ts` hosts `shouldAutoCompact`, `autoCompactIfNeeded`, `formatCompactSummary`, `buildPostCompactMessages`, `getMessagesAfterCompactBoundary`, `stripReinjectedAttachments`, `stripImagesFromMessages`, `normalizeMessagesForAPI`, an injectable-clock retry loop (max 2 retries with exponential backoff 1s/2s), a 30-second keep-alive ticker emitting `keepAlive.tick`, a single-`AbortController` propagation path, and post-compact attachment builders for recent files, invoked skills, plan text, and plan-mode instructions honouring the §3 per-file / per-skill / total-skills / total budgets. `autoCompactIfNeeded` short-circuits on `querySource === 'compact'` or when `shouldAutoCompact` returns `false`, logs `tengu_compact` on success and `tengu_compact_streaming_retry` / `tengu_compact_failed` on the retry path.

## Files touched

- `src/agent/compactConstants.ts` — new. All §3 constants as module-level `const` values, plus `effectiveContextWindow`, `autoCompactThresholdFor`, `resolveContextWindow`.
- `src/agent/compactPrompts.ts` — new. Verbatim §10 prompt constants (preamble, base, detailed analysis, trailer) + `COMPACT_SYSTEM_PROMPT` + `getCompactPrompt`.
- `src/agent/autocompact.ts` — new. Autocompaction engine: `shouldAutoCompact`, `autoCompactIfNeeded`, `formatCompactSummary`, `buildPostCompactMessages`, pre-API transforms (`getMessagesAfterCompactBoundary`, `stripReinjectedAttachments`, `stripImagesFromMessages`, `normalizeMessagesForAPI`), post-compact attachment builders, retry loop, keep-alive ticker, abort propagation, telemetry events.

## Tests added or updated

- `tests/unit/autocompact.test.ts` — 41 cases covering AC1–AC13:
  - **compactConstants** (4 cases): §3 pin values, formula, `[1m]` / capability / default priority.
  - **AC3 prompt snapshot** (4 cases): `getCompactPrompt()` equals the verbatim concatenation with and without `customInstructions`; preamble / trailer / base / detailed-analysis anchor text checks; `COMPACT_SYSTEM_PROMPT` byte-identical.
  - **AC1 threshold** (5 cases): boundary at `threshold - 1` (false) and `threshold` (true) for 200 k default; same pair for 1 M `[1m]`; provider-capability override; `snipTokensFreed` subtracts before compare; `querySource='compact'` guard returns false.
  - **AC2 short-circuit** (2 cases): `querySource='compact'` and below-threshold both return null without calling `provider.stream` (zero requests captured).
  - **AC4 payload** (1 case): system prompt `COMPACT_SYSTEM_PROMPT`, tools undefined, `maxTokens = min(COMPACT_MAX_OUTPUT_TOKENS, providerMaxOutput)`, last user message starts with `NO_TOOLS_PREAMBLE` text, model forwarded.
  - **AC5 pre-API transforms** (5 cases): `getMessagesAfterCompactBoundary` slice, no-boundary passthrough, `stripReinjectedAttachments` filters `[leo.skill.discovery]` / `[leo.skill.listing]` prefixes, `stripImagesFromMessages` replaces `[image:...]` / `[document:...]` markers, `normalizeMessagesForAPI` merges adjacent assistant chunks.
  - **AC6 assembly order** (2 cases): `[boundary, ...summary, ...messagesToKeep, ...attachments, ...hookResults]` end-to-end + optional `messagesToKeep` passthrough.
  - **AC7 file attachments** (2 cases): enforces `POST_COMPACT_MAX_FILES_TO_RESTORE=5`, per-file cap `POST_COMPACT_MAX_TOKENS_PER_FILE=5_000`, total budget cap `POST_COMPACT_TOKEN_BUDGET=50_000`; excludes files already visible in preserved messages.
  - **AC8 skill attachments** (1 case): six 30 k-token skills get capped per-skill at 5 k and total at 25 k.
  - **AC9 keep-alive** (1 case): injectable `setIntervalFn` / `clearIntervalFn` asserts the tick handler fires twice while the stream is open and the interval is cleared on completion.
  - **AC10 streaming retry** (2 cases): three consecutive failures produce two `tengu_compact_streaming_retry` records + one `tengu_compact_failed {reason: 'no_streaming_response'}` and `null` return; success on second try emits exactly one retry record.
  - **AC11 `formatCompactSummary`** (7 cases): analysis-only throws, summary-only prefixes, both drops analysis, neither throws, nested `<T>` angle-brackets preserved, blank-line collapse, trailing whitespace trim.
  - **AC12 invariants** (2 cases): first non-boundary message in the assembled output has `role: 'user'`; the assembled output contains no bare `role: 'tool'` messages that would break pairing.
  - **AC13 abort** (1 case): aborting the signal mid-stream clears the keep-alive interval and returns null.
  - **telemetry** (1 case): `tengu_compact` event carries `{preCompactTokenCount, postCompactTokenCount, truePostCompactTokenCount, autoCompactThreshold, isAutoCompact, querySource, compactionInputTokens, compactionOutputTokens, compactionTotalTokens}`.
  - **purity** (1 case): `shouldAutoCompact` spies `fetch` and asserts zero calls.

Net delta: +41 tests (777 → 818 passing).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **`BASE_COMPACT_PROMPT` omits the `[DETAILED_ANALYSIS_INSTRUCTION - see below]` inline placeholder** from compact.md §10. The feature's AC3 formula is `NO_TOOLS_PREAMBLE + BASE_COMPACT_PROMPT + DETAILED_ANALYSIS_INSTRUCTION + …`, i.e. the three strings are concatenated with no placeholder substitution. To keep the rendered prompt well-formed I stored the prologue + sections list in `BASE_COMPACT_PROMPT` and placed `DETAILED_ANALYSIS_INSTRUCTION` AFTER the sections list in the final prompt rather than inline where the spec shows the placeholder. This is a deviation from the spec's authorial ordering but matches the formula's concatenation exactly and is pinned by the AC3 snapshot tests. Open question for verifier: is the inline placement required?
- **`maxOutputTokensForModel` fallback: `COMPACT_MAX_OUTPUT_TOKENS` (20 000)** when the option is absent, not the `MAX_OUTPUT_TOKENS_DEFAULT` (32 000) hinted at in the feature Open question §3. The clamp is `min(COMPACT_MAX_OUTPUT_TOKENS, opts.maxOutputTokensForModel ?? COMPACT_MAX_OUTPUT_TOKENS)`; providing `maxOutputTokensForModel < 20_000` lowers the cap (e.g. test AC4 uses 8 000), absent leaves it at 20 000. Settings-tab override (F03 Open question §3) will slot in later.
- **Module is not yet wired into `AgentRunner`.** F43's ACs verify the engine in isolation (injectable provider + logger + clock). The feature doc references `F10 AgentController` for `AbortController` propagation (AC13) and recent-file tracking (AC7 Open question §4), but all exercises use injectable seams (`signal`, `recentFiles`, `invokedSkills`, `plan`, `planMode`). Wiring lands when F44 (PTL retry) / F45 (circuit breaker) / F46 (ContextAnalyzer) consumers go in — none of which existed at this iteration. Running the existing agentRunner suite is unaffected (no import reaches autocompact yet).
- **`[leo.skill.discovery]` / `[leo.skill.listing]` markers** chosen as Leo's prefix for `stripReinjectedAttachments` — Leo currently has no skill-discovery / skill-listing attachment flow, so the filter is effectively a no-op on real traffic but the transform is in place for F22+ skill-attachment work later.
- **Recent-file LRU source** is injected via `RecentFileSource` (Open question §4); no `AgentController` LRU map yet. The adapter signature mirrors what F10 will expose when it lands.

## Assumptions

- Token estimation for threshold decisions uses `tokenCountWithEstimation` from F41 when any assistant message carries `usage`, falling back to `estimateMessageTokens` otherwise; both are existing F41 surfaces. Leo's `ChatMessage` is flat (string content), so the message → `TokenMessage` adapter maps `content` directly.
- Streaming retry backoff schedule is 1 s, 2 s (base `1_000ms` × 2^attempt) per the upstream "exponential backoff" phrasing at §7 Phase 3 Path B; the feature text does not pin a formula, just "exponential backoff" and "up to 2 retries".
- Keep-alive is a cheap log-only tick (no wire-level ping) per Open question §6. `setInterval(fn, 30_000)` is injectable for testing so fake timers aren't required to exercise the handler.
- `formatCompactSummary` matches the first `<summary>…</summary>` in the output after stripping all `<analysis>` blocks; nested angle brackets inside the summary are preserved because the regex is non-greedy (`[\s\S]*?`). `<summary>` without a matching closer throws.
- Post-compact file attachments read from the caller-supplied `RecentFileSource`, ordered by `mtime` descending; memory files and already-visible files are excluded via a path-extraction regex (`*.md|*.ts|*.tsx|*.js|*.jsx|*.json|*.canvas`).
- Post-compact skill attachments iterate `invokedSkills` in the supplied order; per-skill cap is enforced before total-skill cap, then total-budget cap dominates.

## Open questions

- **Auto-compact disable setting** (feature Open question §1): not implemented — ships always-on until F03 adds an Advanced-section toggle.
- **Cache-sharing Path A** (feature Open question §2): not implemented — Path B only.
- **Inline vs trailing `DETAILED_ANALYSIS_INSTRUCTION` placement**: current impl places it AFTER the sections list because the AC3 formula is a plain concatenation. If the verifier insists on the spec's inline placement, splitting `BASE_COMPACT_PROMPT` into head/tail and changing the concat order is a one-line fix.
- **Summary-output validation** (feature Open question §5): current impl fails closed if no `<summary>` block is present. It succeeds with `<summary>`-only (no `<analysis>`) per the "Proposing succeed with a debug-level log" proposal but does not emit a warning log for that case — easy to add.
- **F10 `AbortController` wiring**: deferred until the AgentRunner slot is added alongside F44–F46 consumers; the engine already threads a single `AbortController` end-to-end.
- **Transcript write-back + session metadata re-append**: compact.md §7 Phase 6 mentions "Write transcript segment for pre-compaction messages" and "Re-append session metadata" — Leo has no transcript write-back yet (lives in the conversation store later); out of iteration 1.
