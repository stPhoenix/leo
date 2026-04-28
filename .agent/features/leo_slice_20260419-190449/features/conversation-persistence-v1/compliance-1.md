# Compliance iteration 1 — F14 conversation-persistence-v1

## Acceptance criteria

- AC1 (`load()` on onload returns empty thread with schemaVersion 1 when missing; populated thread otherwise; messages feed `AgentRunner` before `ChatView` renders): PASS — `src/main.ts:107` awaits `conversationStore.load()` **before** `registerView(...)` at `:154`; the returned thread's `messages` seed both `ChatMessageStore` (`:109`) and `AgentRunner.historyByThread` (`:118-126`). Missing-file path returns `emptyThread(…)` at `src/storage/conversationStore.ts:62-65` with no throw. Test `tests/unit/conversationStore.test.ts` "load on missing file returns an empty thread with schemaVersion 1…".
- AC2 (`save(thread)` serialises declared schema, writes atomically via temp + rename, triggered by every terminal event / user-enqueue, debounced to coalesce bursts): PASS — atomic path at `src/storage/conversationStore.ts:92-115`: `mkdir` → `write(tmp)` → `remove(target)` → `rename(tmp, target)`. Triggered by `ChatMessageStore.subscribe` in `src/main.ts:110-116` — the store fires on every append (user enqueue) and every `update` (status flips / token commits from `TurnDispatcher`). 250 ms debounce via the shared `debounce` util. Test "debounces burst mutations into a single atomic write (tmp + rename)".
- AC3 (each persisted Message carries role / tokens / tool_use / tool_result; save→load is deep-equal): PASS — schema at `src/storage/conversationSchema.ts:14-29` pins the message shape; round-trip preserves all fields verbatim; test `tests/unit/conversationSchema.test.ts` "round-trips a thread with user + assistant messages and token usage" and "preserves a tool_use + tool_result pair verbatim".
- AC4 (thread `metadata` with `allowedTools: []` + `skillId: null` default; readers can mutate via `mutate(id, fn)`; values persist): PASS — `parseMetadata` at `src/storage/conversationSchema.ts:106-122` defaults both fields; `ConversationStore.mutate(fn)` at `src/storage/conversationStore.ts:77-84` receives and returns the full thread; test "round-trips messages across save + load" writes and re-reads `allowedTools: ['search_vault'], skillId: 'general'`.
- AC5 (forward-compatible unknown-field preservation + `conversation.schema.unknown-field` log): PASS — `collectExtras` at `src/storage/conversationSchema.ts:191-207` captures foreign keys per scope (top-level, metadata, per-message) into `extras` and logs each; `serializeThread` re-emits them at the same scope. Tests "preserves unknown top-level fields and unknown per-message fields on round-trip" and "emits a conversation.schema.unknown-field log event for each unknown key". Non-object roots throw (`parseThread` `:76-78`), covered by "throws on structurally incompatible root".
- AC6 (unload + reload scenario preserves transcript byte-for-byte at message level; `conversation.load` fires before first render): PASS — the round-trip test instantiates a second `ConversationStore`, loads the same file, and asserts messages + metadata are preserved. `conversation.load` is logged from `load()` which awaits **before** `registerView`, so by the time the `ChatView` factory runs the log has emitted.
- AC7 (unit suite covers round-trip incl. tool_use/tool_result, unknown-field preservation, debounce coalescing, atomic-write failure cleanup, hydration): PASS — see citations above + `conversationStore.test.ts` "cleans up the .tmp file on rename failure" (asserts no stray `.json.tmp` file remains and the promise rejects). Hydration-into-AgentRunner is validated indirectly by `main.ts`'s typed composition — `AgentRunner`'s existing test already proves the `historyByThread` seed is used on the first `send()`.

## Scope coverage

- In scope "`ConversationStore` with `load / save / mutate` against `.leo/conversations/<id>.json` through VaultAdapter": PASS — see AC1/AC2/AC4.
- In scope "Forward-compatible JSON schema with `schemaVersion: 1`": PASS — `CONVERSATION_SCHEMA_VERSION = 1` at `src/storage/conversationSchema.ts:3`; always written out via `serializeThread`.
- In scope "Per-message metadata (role / tokens / tool_use / tool_result)": PASS — see AC3.
- In scope "Per-thread metadata (allow-list + skillId) written even when empty/null": PASS — see AC4. `serializeMetadata` always writes both keys.
- In scope "Startup hydration wired into `Plugin.onload` after F01 before `ChatView` mounts": PASS — see AC1.
- In scope "Debounced writes on terminal events + user enqueue; atomic via temp + rename": PASS — see AC2.
- In scope "Structured log events + Vitest coverage": PASS — `conversation.load`, `conversation.save`, `conversation.schema.unknown-field` are all emitted and covered by tests.

## Out-of-scope audit

- Out of scope "Multi-thread CRUD": CLEAN — thread id hard-coded to `'default'` at the store boundary; no directory scan; no thread list UI.
- Out of scope "Plan-mode / todo session resume": CLEAN — `tool_use` / `tool_result` payloads survive the round-trip but no rehydration-into-plan logic added.
- Out of scope "Compaction snapshots / microcompaction": CLEAN — `metadata.extras` reserves room but nothing is written.
- Out of scope "Per-message action persistence (undo-delete, edit-and-resend)": CLEAN — only the base `ChatMessageRecord` fields are persisted.
- Out of scope "Settings / secrets storage": CLEAN — the new module touches `.leo/conversations/` only; settings remain in `data.json` as before.

## QA aggregate

Verdict: PASS (typecheck, lint, 277/277 tests, build ~207 KB).

## Verdict: PASS
