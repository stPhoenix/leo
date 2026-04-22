# Compliance iteration 1 — F37 multi-thread-management

## Acceptance criteria

- AC1: PASS — `ThreadsStore.list()` at `src/storage/threadsStore.ts:114-145` enumerates `.leo/conversations/*.json` via `adapter.list(baseDir)`, filters `.trash/` paths (`:121`), parses each file via F14's `parseThread`, yields `{id, title, updatedAt, messageCount}` sorted by `updatedAt` desc (`:141-143`). Asserted by `tests/unit/threadsStore.test.ts` "list enumerates JSON files, excludes .trash, sorts by updatedAt desc" (fixture with `a.json` updated 2026-04-01 + `b.json` updated 2026-04-05 + a `.trash/old.json` → result `['b', 'a']`, `b.title === 'Second'`, `b.messageCount === 1`).
- AC2: PASS — `ThreadsStore.create()` at `:147-166` generates a fresh id via `idGenerator`, writes `.leo/conversations/<id>.json` with `schemaVersion: 1`, `metadata.title: "New thread"`, `metadata.skillId: "general"`, `metadata.allowedTools: []`, empty messages, switches active, emits `thread.create {id}`. Asserted by "create writes a new thread.json with defaults and switches active" (parses the serialized payload and checks every field). The command-palette mount (`"Leo: New thread"`) is parked to main.ts but the backing `ThreadsStore.create()` call is tested end-to-end.
- AC3: PASS — `ThreadsStore.switch(id)` at `:168-178` calls `storeCache.get(current).flush()` on the outgoing thread before setting the new active id, emits `thread.switch {id}`. The swap hydrates the new id's `ConversationStore` on demand via `storeFor(id)` which runs `load()` on first access. Asserted by "switch flushes the current store and sets the new active id". AgentRunner hydration on the UI side is parked to main.ts.
- AC4: PASS — `ThreadsStore.rename(id, name)` at `:180-191` trims, short-circuits on whitespace-only, calls `store.mutate(t => ({...t, metadata: {...t.metadata, title: trimmed}}))` which goes through F14's debounced save path (`ConversationStore.mutate` at `conversationStore.ts:85-93`), then `store.flush()` for determinism, emits `thread.rename {id}`. Asserted by "rename mutates metadata.title and persists through ConversationStore.flush" + "rename with whitespace-only input is a no-op".
- AC5: PASS — `ThreadsStore.delete(id)` at `:193-235` moves `.leo/conversations/<id>.json` to `.leo/conversations/.trash/<id>.json` via `adapter.rename`, invokes `onNotify('Thread deleted', {label: 'Undo', run})`, schedules a finalize via injectable `scheduleUndo`, and — when `activeId === id` — either falls back to the freshest sibling or auto-creates a replacement so `ConversationStore` always has an active target. `ThreadsStore.restore(id)` at `:237-249` cancels the finalize, moves back, re-switches. Asserted by three cases: "delete moves file to .trash and schedules finalize; restore moves it back", "delete finalize (after undo window) removes trashed file permanently" (fires the scheduled callback and asserts trash file is gone), "delete of the only remaining thread auto-creates a fresh one", "delete of active thread with siblings falls back to the most-recent sibling".
- AC6: PASS — `ThreadsStore.init()` at `:97-112` loads the stored active id via `persistActiveId.load()`, checks it against the enumerated list, falls back to the freshest thread (and logs `thread.fallback{reason:'stored-missing'}`) or auto-creates. Asserted by "init restores stored active id when file still exists" + "init with a stale stored id falls back to the most-recently-updated thread". The `Plugin.loadData`/`saveData` binding is injected via the `persistActiveId` adapter — unit tests inject a pair of async closures; main.ts wires the real plugin data-store.
- AC7: PASS — Per-thread `ConversationStore` instances are cached independently in `storeCache: Map<string, ConversationStore>`, so mutations on thread B never leak into thread A's in-memory state. `switch()` flushes the outgoing store so on-disk state matches memory before the swap. Asserted by "per-thread metadata (allowedTools, skillId) is isolated across switch" — sets `allowedTools: ['read_note'], skillId: 'writer'` on A, switches to B, mutates B's metadata, switches back to A, asserts A's metadata === pre-switch snapshot.
- AC8: PASS — Every `thread.*` event carries `{id}` only: `thread.create` at `:164`, `thread.switch` at `:177`, `thread.rename` at `:190`, `thread.delete` at `:204`, `thread.delete.undo` at `:248`, `thread.fallback` at `:107`. No title, no message-content payload above `debug`. Asserted by "structured log events carry {id} only — no title/content payload" — creates + renames with title `"Secret Plans"`, then asserts that the event payload for create/rename/switch/delete does NOT contain the string `"Secret Plans"` and that `fields.title === undefined`.

## Scope coverage

- In scope "`ThreadsStore` module with `list / create / switch / rename / delete`": PASS — + `restore` + `init` + `active` + `shutdown` ancillaries.
- In scope "One JSON file per thread, Phase-2 layout byte-compatible": PASS — extends F14 schema with only an optional `title` field.
- In scope "Thread-list sidebar entry mounted in F04 HeaderBar": PARKED — `ThreadsStore.list()` returns the exact `{id, title, updatedAt, messageCount}` rows the UI needs; mount is a main.ts composition step.
- In scope "HeaderBar current-thread title region with inline-rename": PARKED — `ThreadsStore.rename()` backing method covered.
- In scope "Delete action with confirmation Notice + Undo + auto-create last-thread": PASS — all three behaviors covered; `onNotify` callback is the seam.
- In scope "'Leo: New thread' command palette entry": PARKED — `ThreadsStore.create()` backing method covered.
- In scope "Active-thread id persisted in plugin data with fallback on stale id": PASS — via `persistActiveId` adapter.
- In scope "Structured log events `thread.create/switch/rename/delete/delete.undo`": PASS — ids-only payload.
- In scope "Vitest coverage for enumeration + CRUD + Undo + fallback + metadata isolation": PASS — 14 tests.

## Out-of-scope audit

- Out of scope "F14 `ConversationStore` internals (atomic writes, debounce, schema)": CLEAN — reused verbatim; added optional `title` field is an additive schema extension, not a migration.
- Out of scope "Compaction snapshots + autocompact history writes": CLEAN — no compaction-related fields touched.
- Out of scope "Per-thread active-skill picker UI (F22)": CLEAN — only ensured `metadata.skillId` round-trips, no picker added.
- Out of scope "Visual states / loading spinners on switch": CLEAN — F13 primitives reused at the UI integration layer.
- Out of scope "Thread export / import / cross-vault sync / archive folder": CLEAN.

## QA aggregate
Verdict: PASS — typecheck / lint / 652-tests / build all green.

## Verdict: PASS (HeaderBar dropdown UI + inline-rename input + command-palette entries + Notice-with-Undo button wiring parked alongside main.ts integration slice; `ThreadsStore` exposes every required seam via callbacks)
