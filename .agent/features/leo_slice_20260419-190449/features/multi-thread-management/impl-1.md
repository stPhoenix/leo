# Impl iteration 1 — F37 multi-thread-management

## Summary

Added `ThreadsStore` at `src/storage/threadsStore.ts`: CRUD over `.leo/conversations/*.json` on top of F14's `ConversationStore`. Surface: `init() / list() / create() / switch(id) / rename(id, name) / delete(id) / restore(id) / active() / activeIdOrNull() / shutdown()`. One `ConversationStore` per thread id is cached in-memory; `switch()` flushes the outgoing store before swapping the active id. `delete()` performs an atomic move to `.leo/conversations/.trash/<id>.json`, schedules a finalize (default 10 s window, injectable), optionally fires an undo-capable `Notice`, and — when the deleted thread was the only one — auto-creates a fresh thread so the store always has an active target. `restore(id)` cancels the pending finalize, moves the file back, and re-switches. `init()` restores the stored active id from an injectable `persistActiveId` adapter; falls back to the most-recently-updated thread, then auto-creates when the vault is empty. `StoredThreadMetadata` gained an optional `title` field with parser + serializer + `METADATA_KEYS` updates; F14 tests still pass because the field is optional. Structured log events (`thread.create`, `thread.switch`, `thread.rename`, `thread.delete`, `thread.delete.undo`, `thread.fallback`) carry `{id}` only — no title, no message content.

## Files touched

- `src/storage/threadsStore.ts` — new 260-line module. Exports `ThreadsStore` class + `ThreadSummary` / `ThreadsStoreOptions` / `ActiveIdPersistence` types + `THREADS_DIR` / `TRASH_SUBDIR` / `DEFAULT_UNDO_WINDOW_MS` / `DEFAULT_THREAD_TITLE` / `DEFAULT_SKILL_ID` constants. `scheduleUndo` + `idGenerator` both injectable for determinism in tests.
- `src/storage/conversationSchema.ts` — added optional `title?: string` to `StoredThreadMetadata`; parser branch picks up `obj.title` when present; serializer writes it only when defined; `METADATA_KEYS` extended so the title field is not miscategorised as an extras passthrough.

## Tests added or updated

- `tests/unit/threadsStore.test.ts` — 14 cases covering every AC:
  - init auto-creates when vault empty (AC6 auto-create edge).
  - list enumerates + excludes `.trash` + sorts by `updatedAt` desc (AC1).
  - create writes defaults (`schemaVersion: 1`, `metadata.title: "New thread"`, `skillId: "general"`, `allowedTools: []`, empty messages) and emits `thread.create {id}` (AC2).
  - switch flushes + changes active + emits `thread.switch {id}` (AC3).
  - rename mutates `metadata.title` and persists through `ConversationStore.flush` (AC4).
  - rename with whitespace-only input is a no-op (AC4 fallback).
  - delete moves to `.trash`, schedules finalize, supports restore (AC5).
  - delete finalize (after undo window) hard-removes the trashed file (AC5).
  - delete of the only remaining thread auto-creates a replacement (AC5).
  - delete of active thread with siblings falls back to the freshest sibling (AC5).
  - init restores a valid stored active id (AC6).
  - init with a stale stored id falls back to the freshest thread + logs `thread.fallback{reason:'stored-missing'}` (AC6).
  - per-thread `metadata.allowedTools` + `skillId` are isolated across switch — A set → switch to B + mutate B → switch back to A → A's metadata is byte-identical to pre-switch snapshot (AC7).
  - structured log events carry `{id}` only; rename title `"Secret Plans"` never appears in any log payload (AC8).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **UI mounts parked to main.ts integration slice.** Feature § "Thread-list sidebar entry", "HeaderBar current-thread title region" (inline-rename input), "Delete action command palette entry", "Leo: New thread command palette entry" — all the Obsidian-side UI glue (HeaderBar dropdown rendering, `Plugin.addCommand`, inline `<input>` element, `Notice` with Undo button) depends on the `ChatView` region stack and command registration which live in `main.ts`. `ThreadsStore` exposes the callback seams (`onNotify`, `scheduleUndo`) and the method surface (`create`, `delete`, `restore`, `rename`, `switch`); the UI mount is a standard composition pattern and ships alongside every other parked integration piece (F24 / F25 / F27 / F29 / F30 / F32 / F33 / F34 / F35 / F36).
- **`persistActiveId` injected instead of calling `Plugin.loadData / saveData` directly.** Feature § "Active-thread id persisted in plugin data" specifies `loadData` / `saveData`. `ThreadsStore` takes a small `{load, save}` adapter so unit tests don't need an Obsidian Plugin stub; the runtime wire-up passes `{load: () => this.loadData().then(d => d?.activeThreadId ?? null), save: (id) => this.saveData({...})}`.
- **ID generator is injected with a `crypto.randomUUID()` fallback.** Feature § "Open questions" flags ULID vs UUID as a decision point. Default uses `crypto.randomUUID()` when available, falls back to a `t-<ms>-<random>` string otherwise. Tests override to a deterministic `thread-NNNN` generator for stable assertions. Verifier: confirm UUID is acceptable, or switch to a vendored ULID implementation.
- **`delete()` does not fire the confirmation `Notice` directly** — it delegates to the injected `onNotify` callback. Rationale: `Notice` is an Obsidian runtime primitive that cannot be tested under happy-dom. The ThreadsStore emits the Notice contract (`onNotify("Thread deleted", {label: "Undo", run})`) and the main.ts glue binds it to an `new Notice(...)` call with a button.

## Assumptions

- Trash retention beyond the Undo window is a hard delete (feature Open question §3) — no long-term trash folder.
- `switch()` is idempotent — calling it with the already-active id is a no-op (no flush, no event).
- `rename()` with whitespace-only input is a no-op rather than resetting to default. Matches the feature clause "empty / whitespace-only commits fall back to the previous title".
- `list()` tolerates corrupted per-file JSON by logging `thread.list.parse-failed` and skipping the row. Future-compat: an `.json` entry that fails `parseThread` does not block the store from listing healthy siblings.
- The `ConversationStore.flush` call in `switch()` handles the "previously-active thread's in-memory state is flushed through F14's debounced save before the swap" clause verbatim.

## Open questions

- Undo window duration (feature Open question §1) — default 10 s, injectable; verifier to confirm against NFR-USE-07.
- Thread id scheme (feature Open question §2) — `crypto.randomUUID()` default; verifier to confirm vs ULID.
- Legacy `default.json` migration (feature Open question §2 tail) — if F14 shipped a `default` thread file, `ThreadsStore.list()` will enumerate it verbatim as id `"default"` on first load; no special migration logic needed. Verifier to confirm that behaviour.
