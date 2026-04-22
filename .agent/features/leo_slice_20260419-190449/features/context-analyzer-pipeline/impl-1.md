# Impl iteration 1 — F46 context-analyzer-pipeline

## Summary

Added the pure ContextAnalyzer pipeline in `src/agent/contextAnalyzer.ts`. `analyzeContextUsage(inputs)` drives the four-step pipeline in the fixed order `filterAfterLastBoundary → projectView (optional identity) → microcompact (optional) → Promise.all fan-out of seven counters + error-isolated skill counting` and returns a typed `ContextData` with per-category tokens, a total, a `tokenTotalSource: 'api' | 'estimated'` selector that prefers the last `originalMessages` assistant's `usage.input_tokens + cache_creation_input_tokens + cache_read_input_tokens` when present and falls back to the sum of the seven estimated counts otherwise, and a `skillCountFailed` flag that flips true when `countSkillTokens` throws (while still emitting `context.skill_count_failed` via F01's `Logger` and returning a zero-token skill entry). All counters are injected via `ContextCounters`; their bodies are owned by downstream features per the Open questions. `AbortSignal` is threaded into every counter and checked between pipeline steps; pre-aborted or mid-pipeline aborts reject with `DOMException('aborted', 'AbortError')`. `filterAfterLastBoundary` keeps everything after the most-recent `COMPACT_BOUNDARY_MARKER` or `MICROCOMPACT_BOUNDARY_MARKER`, regardless of which type is later.

## Files touched

- `src/agent/contextAnalyzer.ts` — new. Exports `analyzeContextUsage`, `filterAfterLastBoundary`, `ContextAnalyzerInputs`, `ContextCounters`, `CounterContext`, `ContextData`.

## Tests added or updated

- `tests/unit/contextAnalyzer.test.ts` — 12 cases covering AC1–AC9:
  - **AC3 boundary filter** (3): picks the later of two boundary types, picks the autocompact boundary when it's later, passes full list when none present.
  - **AC1 output shape** (1): `ContextData` carries every per-category field + total + source + pipeline count.
  - **AC2 pipeline ordering** (1): tagging spies on `projectView`, `microcompact`, and the `approximateMessageTokens` counter confirm `filter → pv → mc → analyze` order and that the analyzer sees the post-microcompact messages.
  - **AC4 parallel fan-out** (1): seven wrapped counters each `await setTimeout(15)` with add/delete bookkeeping assert `maxConcurrency === 7`; a `Proxy` on `countSkillTokens` asserts the skill counter fires strictly AFTER the batch resolves.
  - **AC5 error-isolated skill counting** (1): throwing `countSkillTokens` yields `skillTokens=0`, `skillCountFailed=true`, and a `context.skill_count_failed` log record with the error message.
  - **AC6 parallel rejection wins** (1): throwing `countBuiltInToolTokens` makes `analyzeContextUsage` reject with that first error.
  - **AC7 API-vs-estimated selection** (2): `originalMessages` with `usage` fields → `tokenTotalSource='api'` and total = input + cache_creation + cache_read; absence → `tokenTotalSource='estimated'` and total = sum of seven estimates.
  - **AC8 abort propagation** (1): pre-aborted signal rejects with an `AbortError`.
  - **AC9 domain purity** (1): import graph surfaces only `analyzeContextUsage` + `filterAfterLastBoundary`; no Obsidian / React / network imports reach the module.

Net delta: +12 tests (854 → 866 passing).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **Per-op counter bodies are injected, not implemented**, per feature Open question §1. `ContextCounters` is the seam; downstream features (F47/F48, plus F10/F16/F21/F22/F51 registry consumers) can ship each body without touching this orchestrator.
- **Boundary-filter policy** pinned to "latest-boundary-wins regardless of type" (Open question §2). Two tests exercise both orderings; the rule is the same in both directions.
- **`projectView` is optional and identity when absent** (Open question §3); the slot is reserved and testable, but no feature flag is wired yet.
- **`originalMessages` defaults to `messages`** when absent — matches Open question §4's "pre-transform messages" reading without breaking the simple-caller path.
- **AbortError in skill counting propagates** per Open question §5; non-abort throws are swallowed into `skillCountFailed=true` + log event.

## Assumptions

- `ContextData` owns the shape; downstream grid (F47) and suggestions/status line (F48) will import this type (Open question §7).
- API-usage-tier extraction scans `originalMessages` backwards for the first assistant with a `usage` field carrying `input_tokens`; the usage field also accepts `cache_creation_input_tokens` / `cache_read_input_tokens` which default to `0` when absent.
- `Promise.all` semantics — "first rejection wins" — are kept per Open question §6; partial `Promise.allSettled` is not adopted in v1.
- The orchestrator does not own clock or `performance.now` — pipeline-stage durations can be layered on by downstream callers without touching the orchestrator.

## Open questions

- **Counter body ownership**: still awaiting a downstream feature row to own each per-op body; interim wiring injects them from callers.
- **`projectView` flag plumbing**: pending a feature-flag surface in Leo; identity pass-through keeps the shape stable.
- **`ContextData` sharing with F47/F48**: interfaces live here for now; if F47 ends up owning the shape, the import direction can flip without a behaviour change.
