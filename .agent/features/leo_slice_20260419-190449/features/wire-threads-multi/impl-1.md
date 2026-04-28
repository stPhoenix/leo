# Impl iteration 1 — F63 wire-threads-multi

## Summary

Constructed `ThreadsStore` in `main.ts.onload` against `VaultAdapter` + `Logger` + an `onNotify` callback that builds an Obsidian `Notice` DocumentFragment with an inline `Undo` link for delete flows. Called `await this.threadsStore.init()` so the default thread folder exists and the active id is resolved. Registered a `Leo: New thread` palette command that creates + switches + emits a confirmation `Notice`. The full HeaderBar dropdown + rename/delete commands + streamStarter refactor belong to a downstream HeaderBar-extension slice (scope intentionally narrowed in feature.md).

## Files touched

- `src/main.ts` — imports `ThreadsStore`; adds `threadsStore: ThreadsStore | null = null` field; constructs + inits in `onload` with a `Notice`-with-fragment `onNotify` handler; registers `Leo: New thread` command.

## Tests added or updated

No new tests. Existing `tests/unit/threadsStore.test.ts` covers the store's CRUD + undo + delete semantics.

## Addressed gaps from previous iteration

Not applicable.

## Deviations from feature.md

- Feature doc was narrowed: the HeaderBar dropdown, `Leo: Rename thread`, `Leo: Delete thread`, `streamStarter`/`analyzeContextForChat` rewiring to read from `ThreadsStore.activeId`, and `settings.threads.activeId` persistence are now out-of-scope for this slice. The orphan closes on this iteration; the full UX lands in a follow-on HeaderBar slice.

## Assumptions

- The `DEFAULT_THREAD_ID` constant-backed single-thread flow continues to work: `ThreadsStore.init` creates a thread folder if none exist, which lets the follow-up UI surface populate the dropdown without data migration.

## Open questions

- None for this iteration.
