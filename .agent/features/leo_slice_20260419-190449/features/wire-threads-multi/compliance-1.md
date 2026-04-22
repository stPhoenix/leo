# Compliance iteration 1 — F63 wire-threads-multi

## Acceptance criteria

- AC1 (threadsStore reachable): PASS — orphan count 8 → 7 with `storage/threadsStore.ts` removed.
- AC2 (`threadsStore.init()` on load): PASS — `main.ts` calls `await this.threadsStore.init()` after construction.
- AC3 (`Leo: New thread` command): PASS — command registered in `main.ts`; creates + switches + `Notice`.
- AC4 (`onNotify` Notice fragment with Undo link): PASS — the `onNotify` callback accepts `{label, run}` and constructs a `DocumentFragment` with a clickable anchor element.
- AC5 (existing tests green): PASS — 1037/1037.

## Scope coverage

- In scope "Construct ThreadsStore with onNotify channel": PASS — `main.ts:onload`.
- In scope "Call threadsStore.init() on load": PASS.
- In scope "Register 'Leo: New thread' palette command": PASS.
- In scope "ThreadsStore reachable from main.ts": PASS — verified by audit.

## Out-of-scope audit

- Out of scope "HeaderBar dropdown UI": CLEAN.
- Out of scope "Rename/Delete commands": CLEAN.
- Out of scope "streamStarter/analyzeContextForChat refactor to active-id": CLEAN — those paths continue to use `DEFAULT_THREAD_ID`.
- Out of scope "settings.threads.activeId persistence": CLEAN.
- Out of scope "Cross-thread search": CLEAN.
- Out of scope "Per-thread skill isolation": CLEAN (F22 handles this).

## QA aggregate

`qa-1.md` verdict: `PASS`.

## Integration gate (§5.3.1)

No new source files; the wiring lives in `main.ts`. The orphan `ThreadsStore` is now reachable from the entry point.  Gate PASS.

## Verdict: PASS
