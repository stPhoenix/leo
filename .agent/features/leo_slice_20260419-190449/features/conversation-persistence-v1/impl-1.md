# Impl iteration 1 — F14 conversation-persistence-v1

## Summary

Added `ConversationStore` + `VaultAdapter` seams under `src/storage/` and wired them into `LeoPlugin.onload`. On startup the store loads `.leo/conversations/default.json` (or returns an empty Phase-2 thread when missing), hydrates `ChatMessageStore` (UI transcript) and `AgentRunner.historyByThread` (prompt context), and subscribes to `ChatMessageStore` changes so every append / status-flip / token-commit schedules a 250 ms-debounced atomic save (write `.tmp` → remove target → rename). The schema is hand-rolled (no zod dep); it preserves unknown top-level, metadata, and per-message fields verbatim via an `extras` side-channel re-emitted on the next save, and logs a `conversation.schema.unknown-field` line per foreign key so later features can register migrations without silent loss. `onunload` flushes any pending save before teardown.

## Files touched

- `src/storage/vaultAdapter.ts` — new: `VaultAdapter` interface (`exists` / `mkdir` / `read` / `write` / `rename` / `remove`) + `createObsidianVaultAdapter(DataAdapter)` factory.
- `src/storage/conversationSchema.ts` — new: `StoredThread` / `StoredMessage` / `StoredThreadMetadata` types, `emptyThread`, `parseThread(raw, ctx)` (validates required fields, captures unknowns as `extras`, emits `conversation.schema.unknown-field` logs), `serializeThread(thread)` (merges declared + `extras` back into the JSON tree).
- `src/storage/conversationStore.ts` — new: `ConversationStore` class with `load` / `mutate(fn)` / `flush` / `dispose`; 250 ms debounced save via the shared `debounce` util; atomic write path = `mkdir` → `write(tmp)` → `remove(target)` → `rename(tmp, target)`, with `finally` `.tmp` cleanup on rename failure and a typed error throw; logs `conversation.load` + `conversation.save`.
- `src/main.ts` — constructs `VaultAdapter` + `ConversationStore`, loads before `ChatView` registration, creates the shared `ChatMessageStore` prepopulated from disk, subscribes store changes → `ConversationStore.mutate`, seeds `AgentRunner.historyByThread`, passes the shared `ChatMessageStore` into `ChatView` deps. `onunload` flushes + disposes the store + releases the subscription.
- Added helpers at the foot of `src/main.ts`: `storedToRecords` / `recordsToStored` / `deriveAgentHistory` / `isAssistantStatus` (pure, local to `main.ts`).
- `tests/unit/conversationSchema.test.ts` — 7 cases: empty round-trip, user+assistant+tokens round-trip, tool_use/tool_result pair preservation, unknown-field top-level + metadata + per-message preservation across a full round-trip, metadata defaults, non-object root throw, `conversation.schema.unknown-field` emission for each foreign key.
- `tests/unit/conversationStore.test.ts` — 5 cases: missing-file load returns empty thread + fires `conversation.load`, debounce coalesces 5 bursts into 1 atomic write, `flush()` bypasses debounce, full save→new-store load round-trip preserves metadata + tokens, rename failure leaves no `.tmp` and rejects.

## Tests added or updated

- 12 new cases. Full suite: 35 files, 277/277 pass.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- No `zod` dependency introduced. The feature note references `z.passthrough()` as an implementation technique, but the same invariants (unknown-field preservation on round-trip, unknown-field log events, structural rejection of non-objects) are delivered with hand-rolled validators. Avoids adding a 70 KB bundle cost for a single schema. If a later feature (e.g. `config.json` MCP server validation) pulls in zod, the store can migrate to a `.passthrough()` schema without changing callers.
- `ConversationStore.mutate` is a functional `(prev) => next` API; the feature spec calls out `mutate(id, fn)` with an explicit thread id. For Phase 2 the id is implicit (one thread per store) — multi-thread support (F37) can extend the store with a thread-id parameter without changing call sites that pre-commit to a single store instance.
- Terminal-event wiring is indirect: instead of subscribing directly to `AgentRunner` terminal events we subscribe to `ChatMessageStore` changes (which already flip `status: 'streaming' → 'done' | 'error' | 'cancelled'` on terminal events via `StreamingTurnController`, and commit `tokens` via `TurnDispatcher.trackUsage`). That funnel is strictly broader ("any UI state change persists") and satisfies AC2's debounced write trigger; the 250 ms debounce coalesces streaming-token churn into a single write per window.

## Assumptions

- The persistent Phase-2 thread id is the literal string `'default'` exported as `DEFAULT_THREAD_ID`. F37 will replace this constant with per-thread ids + a directory scan; the schema already supports it because `id` is carried in the file itself.
- Banner records (role `'banner'`) in `ChatMessageStore` are persisted and re-hydrated because they carry cancel / error context users expect to see on reopen. When a future feature drops banner persistence, `storedToRecords` / `recordsToStored` are the only callsites to update.
- `conversation.save` currently fires per flush; fine-grained "only on terminal events" is left for a future optimisation when write amplification becomes observable. Ship cost is bounded by the 250 ms debounce window.

## Open questions

None.
