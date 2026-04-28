# Impl iteration 1 — F48 context-suggestions-statusline

## Summary

Added `src/ui/contextSuggestions.ts` with the pure `generateContextSuggestions(data)` engine (five ordered checks: near-capacity, large-tool-results, read-bloat, memory-bloat, autocompact-disabled), the frozen `CONTEXT_SUGGESTION_THRESHOLDS` object pinning the six §12.1 / §16 values, per-tool advice for Bash/Read/Grep/WebFetch/generic with the correct severity + multiplier tuple, `sortSuggestions` enforcing warnings-first / `savingsTokens`-descending / stable-tiebreak ordering, the pure `buildStatusLineContext(apiUsage, contextWindowSize)` builder emitting the exact six §14 fields with `Math.round` clamp to [0, 100] and null-safe handling, and `createDebouncedStatusLineUpdater({build, write, debounceMs, onError})` that wraps the trailing-edge 500 ms debounce, catches throws inside the build/write callbacks, and honours `dispose()` teardown so no timer fires post-unload.

## Files touched

- `src/ui/contextSuggestions.ts` — new. Exports `CONTEXT_SUGGESTION_THRESHOLDS`, `ContextSuggestion`, `ContextSuggestionInputs`, `MemoryFile`, `ToolBreakdown`, `generateContextSuggestions`, `sortSuggestions`, `ApiUsageLike`, `StatusLineContext`, `buildStatusLineContext`, `StatusLineUpdateDeps`, `StatusLineUpdater`, `createDebouncedStatusLineUpdater`.

## Tests added or updated

- `tests/unit/contextSuggestions.test.ts` — 28 cases covering AC1–AC10:
  - **Constants** (2): exact §12.1 / §16 pinning; `Object.isFrozen`.
  - **AC1 near-capacity** (5): 79/80/81 boundary, autocompact-on/off detail-text switch, `savingsTokens = totalTokens - autoCompactThreshold`.
  - **AC2 large-tool-results** (5): 14%/≤10k suppression, Bash warning with 50 % multiplier, Read/Grep/WebFetch info with 30/30/40 % multipliers, generic ≥20 % info at 20 %, generic 15–20 % suppressed.
  - **AC3 read-bloat** (2): suppressed when Read was flagged by large-tool-results; fires otherwise.
  - **AC4 memory-bloat** (1): five-file fixture, detail contains exactly the top-3 largest paths.
  - **AC5 autocompact-disabled window** (5): 49/50/79/80 boundaries with autocompact on/off, assertion table.
  - **AC6 sorting** (1): mixed warnings/info with varied savings; stable ordering within ties.
  - **AC7 purity** (1): `fetch` spy asserts zero calls.
  - **AC8 `buildStatusLineContext`** (3): typical usage six-field result, over-window clamp to 100 %, null usage → null return.
  - **AC9/AC10 debounced updater** (3): five rapid triggers collapse to one write at 500 ms trailing edge, `dispose` cancels pending timer, throwing build routes through `onError` and leaves writer untouched.

Net delta: +28 tests (884 → 912 passing).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **React suggestion block + Obsidian `addStatusBarItem` wiring are parked** pending plugin runtime wiring. The feature's pure surfaces (suggestion engine, status-line builder, debounce factory) are shipped and tested; the DOM mount lands with `main.ts` consumption.
- **`ContextSuggestionInputs` is a narrow read-only shape** instead of the full `ContextData` to decouple from F46's ownership until F46/F47 finalise their shared type (matches F47 Open question §7). Callers adapt `ContextData → ContextSuggestionInputs`.
- **Per-tool attribution** reads from an injected `toolResultsByType: ToolBreakdown[]` slot (Open question §4 "from messageBreakdown"); absent defaults to `[]` so the check silently no-ops.
- **Near-capacity savings formula** uses `totalTokens - autoCompactThreshold` (Open question §3 proposal) when both values are present; otherwise `savingsTokens` is omitted.
- **Debounce semantics**: trailing-edge only, no max-wait; matches Open question §5 proposal.
- **`buildStatusLineContext` returns `null` when `apiUsage` is absent** (Open question §6 proposal); callers render a `—%` sentinel.
- **§13 token-warning inline banner deferred to F13**: this feature owns only §12 suggestions + §14 status-line, matching Open question §1.

## Assumptions

- `percentage` in `ContextSuggestionInputs` is the usage percentage out of `contextWindow` (0–100 integer-or-float); callers pre-round per F46's `ContextData` tokenTotalSource-based total.
- Memory files are sorted by the caller OR by this engine (the impl sorts by `.tokens` desc internally).
- `CONTEXT_SUGGESTION_THRESHOLDS.READ_BLOAT_TOKENS = 10_000` mirrors the upstream "≥10k" floor implied in §12.2 #3 — §12.1 lists only the percent threshold; the token floor is a pragmatic cap to avoid firing on tiny vaults. Flagged for verifier in Open question §3 proposal.

## Open questions

- **React + Obsidian status-bar wiring**: parked until `main.ts` wiring lands.
- **`ContextSuggestionInputs` vs full `ContextData`**: narrow shape today; can widen when F46 publishes the full interface.
- **`—%` sentinel rendering** when `buildStatusLineContext` returns null: caller responsibility for copy; documented in Open question §6 proposal.
