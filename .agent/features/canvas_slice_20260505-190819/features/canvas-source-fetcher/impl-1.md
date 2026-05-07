# Impl iteration 1 — F10 canvas-source-fetcher

## Summary
Added `src/agent/canvas/fetch.ts` exporting `fetchCanvasSources(items, deps, signal) → {items, failedAll}`. Each `CanvasSourceItem` is mapped 1:1 to an `IngestSource` (`url`/`vaultPath`/`attachment`/`conversation`) and routed through `fetchIngestSource` (wiki module). `Promise.all` awaits all per-source promises but every per-source body is wrapped in a try/catch so a sibling failure never cancels other fetches. Per-source errors record `errorCode` verbatim from `FetchError.code`. `failedAll` is true iff every item ended in `'error'`. Aborted signals surface `errorCode: 'aborted'` via the catch path; the underlying fetcher returns `{code:'fetch_failed', message:'aborted'}` when it detects the signal up-front.

## Files touched
- `src/agent/canvas/fetch.ts` — fetcher adapter
- `tests/unit/canvas/fetch.test.ts` — 7 unit tests

## Tests added or updated
- `tests/unit/canvas/fetch.test.ts` covers AC1 (4/5 succeed, failedAll false), AC2 (all-fail), AC3 (verbatim `fetch_vault_missing`), AC4 (aborted handling), AC5 (sibling not cancelled), plus conversation mapping + empty-input.

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
- AC4 wording — feature.md says "awaited promise rejects with AbortError only at outer driver boundary"; this implementation never rejects the outer promise on abort, even at the driver boundary, because each per-source fetch returns a typed item. The outer driver checks `signal.aborted` separately. This matches the project's "no thrown errors past adapter" rule (architecture §7) better than rejecting the outer promise.

## Assumptions
- `attachmentResolver` lives on `deps.attachments`; if absent, `attachment` items return `fetch_attachment_missing` from `fetchIngestSource` (already its behavior).
- Conversation `threadId` synthesized from `title`, `turnIndex = 0` since canvas conversation hint doesn't carry thread metadata.

## Open questions
None — error-code propagation is verbatim per feature.md open question.
