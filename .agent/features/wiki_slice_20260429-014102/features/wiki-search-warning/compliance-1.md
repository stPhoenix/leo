# Compliance iteration 1 — F07 wiki-search-warning

## Acceptance criteria
- AC1: PASS — `searchWiki.ts` invoke path: `mutexState.kind === 'busy'` → injects `warning` (exact FR-14 wording from `formatWikiBusyWarning`). Test "adds warning to result when mutex busy" verifies the literal wording.
- AC2: PASS — `createWikiBusyNotifier` retains a `Map<threadId, lastTimestamp>` and gates re-emit by `WIKI_BUSY_NOTICE_INTERVAL_MS=60_000`. Test "fires notify on first call per thread, suppresses subsequent within interval" + "different threads are independent".
- AC3: PASS — Reads execute the same index→body path; warning is appended to the otherwise-normal result. Test "reads continue normally with warning attached".
- AC4: PASS — Idle branch omits `warning` from the schema (`...(warning !== undefined ? { warning } : {})`); notifier untouched. Test "omits warning when mutex idle; does not call notifier".
- AC5: PASS — `wikiSearchWarning.test.ts` covers both branches (idle + busy) of result injection AND rate limiter (within-window suppression + cross-thread independence).

## Scope coverage
- In scope "Inject warning into SearchWikiResult whenever WikiMutex.active() is non-null": PASS — see AC1.
- In scope "Emit Obsidian Notice toast at most once per minute per threadId while mutex is held": PASS — see AC2.
- In scope "Reads continue to be served regardless of mutex state": PASS — see AC3.

## Out-of-scope audit
- Out of scope "blocking on the mutex": CLEAN — `search_wiki` never calls `acquire`; reads always succeed.
- Out of scope "modifying any read behavior beyond the warning": CLEAN — match selection logic unchanged.

## QA aggregate
QA verdict: PASS (typecheck/lint/2163 tests/build all PASS).

## Integration notes
- `searchWarning.ts` reached from `main.ts:97` (`createWikiBusyNotifier`) and `searchWiki.ts:14` (`formatWikiBusyWarning`).
- F05's `WikiMutex.active()` is now consumed by both `/wiki-status` (F03) and `search_wiki` (F07).
- No stub bodies (§5.3.2): all functions have functional implementations.

## Verdict: PASS
