# Impl iteration 1 — F07 wiki-search-warning

## Summary
Added busy-warning surface to `search_wiki`: result Zod shape extended with optional `warning` field; per-thread rate-limited Notice toast; both wired in `main.ts` from F05's `WikiMutex`. Reads continue normally regardless of mutex state.

## Files touched
- `src/agent/wiki/searchWarning.ts` — `formatWikiBusyWarning(state)` (FR-14 wording), `createWikiBusyNotifier({notify, intervalMs?, now?})` per-thread rate limiter, `WIKI_BUSY_NOTICE_INTERVAL_MS=60_000`.
- `src/tools/builtin/searchWiki.ts` — schema gains optional `warning`; deps gain `getMutexState?` + `notifyBusy?`; invoke checks mutex → injects `warning` and fires notifier with thread id; falls back cleanly when deps absent.
- `src/main.ts` — instantiates `createWikiBusyNotifier({notify: msg => new Notice(msg)})` and passes into `createSearchWikiTool({getMutexState, notifyBusy})`.

## Tests added or updated
- `tests/unit/wikiSearchWarning.test.ts` — `formatWikiBusyWarning` exact wording for ingest/lint busy + idle returns ''. Notifier rate-limits per thread within 60s window, distinct threads independent. End-to-end search_wiki: warning attached on busy + notifier called; idle omits warning + no notifier; matches still produced when busy (read continues).

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
None.

## Assumptions
- Rate limiter is in-memory per plugin process. Plugin reload resets the timestamp map; spec doesn't require cross-reload persistence.
- The `getMutexState` callback returns `{kind:'idle'}` while no run holds the mutex — keeps the search_wiki invoke path total (no null branch needed).

## Open questions
None.
