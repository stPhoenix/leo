# F14 — Conversation persistence (single thread)

## Purpose

Introduce a `ConversationStore` module that persists the single Phase-2 chat thread to `.leo/conversations/<id>.json` so the transcript survives plugin reloads and Obsidian restarts per [FR-CHAT-08](../../context.md#fr-chat-08). The store loads the thread on startup into [F10 agent-controller-core](../agent-controller-core/feature.md)'s in-memory state and writes back debounced on every mutation. The on-disk schema carries a `schemaVersion` sentinel, per-message metadata (role, tokens, `tool_use` / `tool_result` payloads) and per-thread metadata (allow-list and active-skill id) so downstream features — multi-thread CRUD, plan-session resume, compaction snapshots — can extend the file without a destructive migration.

## Scope

### In scope

- `ConversationStore` module owning `load()` / `save(thread)` / `mutate(threadId, fn)` against `.leo/conversations/<id>.json` through the [Architecture §3.4 VaultAdapter](../../../../architecture/architecture.md#34-adapters) seam per [FR-CHAT-08](../../context.md#fr-chat-08); single active thread in Phase 2, directory layout already forward-compatible with multi-thread (F37) as declared in [Architecture §9 Project File Layout](../../../../architecture/architecture.md#9-project-file-layout-proposed).
- Forward-compatible JSON schema (`schemaVersion: 1`) for the thread document: `{ id, createdAt, updatedAt, schemaVersion, metadata: { allowedTools: string[], skillId: string | null }, messages: Message[] }`; unknown fields preserved on round-trip so later features can add keys without migration per the open question on thread-model forward-compatibility in [context.md](../../context.md#open-questions).
- Per-message metadata covering `role` (`user | assistant | tool`), `tokens: { input, output, total, source: "api" | "estimate" }` populated by [F12 token-usage-indicator](../token-usage-indicator/feature.md), and `tool_use` / `tool_result` payloads matching the `StreamEvent` union pinned in [Architecture §4 Key Contracts](../../../../architecture/architecture.md#4-key-contracts).
- Per-thread `metadata` block carrying the `Allow for thread` tool allow-list consumed by [FR-AGENT-11](../../context.md#fr-agent-11) (populated later by F17) and the active `skillId` (populated later by F22); fields are written even when empty/null so readers can rely on their presence.
- Startup hydration wired into `Plugin.onload` after [F01 plugin-bootstrap-logging](../plugin-bootstrap-logging/feature.md) per the [Architecture §5.1 Plugin Startup](../../../../architecture/architecture.md#51-plugin-startup) sequence, feeding the recovered transcript into [F10 agent-controller-core](../agent-controller-core/feature.md) before the `ChatView` mounts so the message list renders populated.
- Debounced writes (single shared `debounce` util per [code-style — Async & Concurrency](../../../../standards/code-style.md#async--concurrency)) on every `AgentRunner` terminal event (`done` / `error` / `cancel`) and on user-message enqueue; atomic write via write-to-temp + rename through the `VaultAdapter`.
- Structured log events (`conversation.load`, `conversation.save`, `conversation.schema.unknown-field`) through the [F01 Logger](../plugin-bootstrap-logging/feature.md) and Vitest coverage for schema round-trip, unknown-field preservation, debounce behaviour, and hydration feeding `AgentRunner`.

### Out of scope

- Multi-thread CRUD (create / switch / rename / delete, thread list UI, per-thread sidebar) → ships with [F37 multi-thread-management](../../features-index.md); this feature hard-codes a single active thread id.
- Plan-mode / todo session resume (`TodoWrite` rehydration, plan snapshot → tool_use → attachment fallback chain) → ships with [F26 plan-session-resume](../../features-index.md); this feature persists tool_use payloads verbatim but does no rehydration logic.
- Compaction snapshots, microcompaction history, PTL recovery writes to the transcript → ships with [F42+](../../features-index.md); this feature's schema reserves `metadata` room for them but writes nothing.
- Per-message action persistence beyond the message record (undo-delete, edit-and-resend history) → tracked with [F15 message-actions](../../features-index.md).
- Settings / secrets storage — `data.json` + `SafeStorage` as defined in [Architecture §6 State Ownership](../../../../architecture/architecture.md#6-state-ownership); out of this feature.

## Acceptance criteria

1. `ConversationStore.load()` reads `.leo/conversations/<id>.json` on `Plugin.onload` via the `VaultAdapter` seam; when the file is missing, returns an empty thread with `schemaVersion: 1` and no error; when present, returns a thread whose `messages` feed [F10 agent-controller-core](../agent-controller-core/feature.md) before `ChatView` first renders so the transcript is visible on plugin reload. (FR-CHAT-08)
2. `ConversationStore.save(thread)` serialises the thread to JSON with the declared schema (`{ id, createdAt, updatedAt, schemaVersion, metadata, messages }`), writes atomically (temp file + rename) through the `VaultAdapter`, and is triggered by every `AgentRunner` terminal event (`done` / `error` / `cancel`) and by user-message enqueue, debounced so bursts coalesce into one write. (FR-CHAT-08)
3. Each persisted `Message` record carries `role` (`user | assistant | tool`), `tokens: { input, output, total, source }`, and — for assistant / tool messages — the exact `tool_use` / `tool_result` payload from the `StreamEvent` union in [Architecture §4](../../../../architecture/architecture.md#4-key-contracts); a round-trip (`save → load`) produces a deep-equal thread. (FR-CHAT-08)
4. The thread `metadata` block carries `allowedTools: string[]` (empty array by default) and `skillId: string | null` (null by default); readers (F17 for allow-list, F22 for skill) can mutate these fields through `ConversationStore.mutate(id, fn)` and the updated values are persisted on the next debounce flush. (FR-CHAT-08)
5. The on-disk schema is forward-compatible: unknown top-level keys and unknown per-message keys encountered during `load()` are preserved and re-emitted on the next `save()` (round-trip idempotent), a `conversation.schema.unknown-field` log event records the key path, and no Zod parse error is thrown for additive fields — only structurally incompatible documents error out. (FR-CHAT-08)
6. After a simulated plugin unload + reload (Vitest scenario exercising `onunload` → `onload`), the chat transcript, per-message tokens / tool payloads, the allow-list, and the active skill id all match the pre-unload state byte-for-byte at the message level; the `conversation.load` log event fires before the `ChatView` render gate resolves. (FR-CHAT-08)
7. Vitest unit suite covers: schema round-trip (including empty thread and thread with `tool_use` / `tool_result` pairs), unknown-field preservation, debounce coalescing under burst terminal events, atomic-write failure mode (temp file cleanup on rename failure), and hydration handing the message set to a mocked `AgentRunner` before its first `send()` resolves. (FR-CHAT-08)

## Dependencies

- [F10 agent-controller-core](../agent-controller-core/feature.md) — owns the in-memory thread state, the FIFO queue, and the per-turn `AbortController`; `ConversationStore` hooks into its terminal-event lifecycle and is hydrated into it on startup per [FR-AGENT-01](../../context.md#fr-agent-01), [FR-AGENT-07](../../context.md#fr-agent-07), [FR-AGENT-09](../../context.md#fr-agent-09).
- Drives requirement [FR-CHAT-08](../../context.md#fr-chat-08).
- Downstream consumers tracked in [features-index.md](../../features-index.md): F15 (per-message actions on persisted records), F17 (writes the `Allow for thread` allow-list into `metadata.allowedTools`), F22 (writes the active `skillId` into `metadata.skillId`), F26 (plan / todo session resume reads persisted `tool_use` payloads), F37 (multi-thread CRUD extending this single-thread layout), F42+ (compaction snapshots extending `metadata`).

## Implementation notes

- [Architecture §3.2 Agent Layer — ConversationStore](../../../../architecture/architecture.md#32-agent-layer) — places `ConversationStore` alongside `AgentRunner`; this feature delivers that module with `load / save / mutate` plus debounced persistence.
- [Architecture §5.1 Plugin Startup](../../../../architecture/architecture.md#51-plugin-startup) — pins the `Plug→CS: load conversations (async)` step this feature realises before `ChatView` mounts.
- [Architecture §6 State Ownership](../../../../architecture/architecture.md#6-state-ownership) — fixes `Open threads` and `Active thread id, per-thread allowlist` as `ConversationStore`-owned, persisted in thread JSON — the exact surface this feature materialises.
- [Architecture §9 Project File Layout](../../../../architecture/architecture.md#9-project-file-layout-proposed) — places the module at `storage/ConversationStore.ts` and the files at `.leo/conversations/<id>.json`; single-thread layout remains valid for multi-thread later.
- [Architecture §11 Mapping SRS FR → Modules](../../../../architecture/architecture.md#11-mapping-srs-fr--modules) — routes `FR-CHAT-*` through `AgentRunner` and persistence; this feature binds `FR-CHAT-08` to `ConversationStore`.
- [Tech stack — Storage Layout](../../../../standards/tech-stack.md#storage-layout) — pins `.leo/conversations/<id>.json` as one JSON per thread; forward-compatible with multi-thread.
- [Tech stack — Platform APIs](../../../../standards/tech-stack.md#platform-apis) — fixes the `Vault` adapter surface this feature writes through; never touches `app.vault.adapter` directly.
- [Code style — TypeScript](../../../../standards/code-style.md#typescript) — strict mode, no `any`, named exports, `readonly` on public message fields — governs the `Message` / `Thread` record shapes.
- [Code style — Zod & Tool Schemas](../../../../standards/code-style.md#zod--tool-schemas) — one Zod schema for the thread document with `.passthrough()` for forward-compat; `z.infer` supplies the TS type and `parse()` runs at the `load()` boundary.
- [Code style — Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) — all FS access through `VaultAdapter`, never through `app.vault.adapter`; `Notice` for user-visible errors, `Logger` for everything else.
- [Code style — Async & Concurrency](../../../../standards/code-style.md#async--concurrency) — shared `debounce` util for save coalescing; no synchronous FS in hot paths; every `fetch` / FS write has explicit error handling.
- [Code style — Error Handling](../../../../standards/code-style.md#error-handling) — `finally` cleanup of the temp file on atomic-write failure; adapters convert platform errors to typed `Result`.
- [Code style — Logging](../../../../standards/code-style.md#logging) — structured `conversation.load / save / schema.unknown-field` events; no message content logged beyond `debug`.
- [Code style — Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw) — selects the harness used by AC 7; `VaultAdapter` mocked at the seam, not at the Obsidian API.
- [Best practices — General rules](../../../../standards/best-practices.md) — "do not make things up" and "ask if unclear" govern the forward-compat schema choices surfaced in Open questions below.

## Open questions

- Atomic-write primitive on the `VaultAdapter` seam — SRS and architecture name `.leo/conversations/<id>.json` but do not pin temp-file + rename semantics. Proposing write-to-`<id>.json.tmp` + `rename` with `finally` cleanup; verifier to confirm against Obsidian's `Vault` API contract.
- Debounce window for `save()` — [FR-CHAT-08](../../context.md#fr-chat-08) is silent. Proposing 250 ms (same window as the indexer debounce tier referenced in [code-style — Async & Concurrency](../../../../standards/code-style.md#async--concurrency)) plus an immediate flush on `Plugin.onunload`; verifier to confirm.
- Single thread id for Phase 2 — the slice persists one thread; proposing a constant `"default"` id until [F37 multi-thread-management](../../features-index.md) introduces real thread ids, so file path is `.leo/conversations/default.json`. Resolves the [thread-model forward-compatibility open question in context.md](../../context.md#open-questions) in the direction "no migration needed".
- `tool_use` / `tool_result` payload shape on disk — [Architecture §4](../../../../architecture/architecture.md#4-key-contracts) pins the in-memory `StreamEvent` union but not the on-disk spelling. Proposing verbatim JSON serialisation of the union's `call` / `result` fields; verifier to confirm once [F16 tool-registry-builtin-read](../../features-index.md) lands with concrete payloads.
