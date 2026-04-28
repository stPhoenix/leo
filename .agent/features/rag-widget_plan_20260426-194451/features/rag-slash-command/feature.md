# F03 · rag-slash-command — `/rag` slash command + wiring

## Purpose

Connect [F01 · rag-snapshot](../rag-snapshot/feature.md) to [F02 · rag-widget](../rag-widget/feature.md) via a `/rag` chat slash command (and matching command palette entry), so a user typing `/rag` in the composer triggers an abortable snapshot collection and appends a widget message of kind `rag` to the active thread. Plumbs the new dependencies (vector store, indexer drain tap, graph cache, exclude store, embedding model resolver, logger) from `main.ts` through `ChatView` deps. Covers [FR-01](../../context.md#functional-requirements), [FR-08](../../context.md#functional-requirements), [FR-10](../../context.md#functional-requirements), [NFR-07](../../context.md#non-functional-requirements), [NFR-08](../../context.md#non-functional-requirements).

## Scope

In scope:

- New module `src/ui/ragCommand.ts` (mirrors `contextCommand.ts`):
  - `createRagCommand(deps): RagCommandHandle` returning `{ invoke, cancel }`.
  - Internal `AbortController` lifecycle so a re-issue cancels the prior in-flight collection ([FR-04 boundary](../../context.md#functional-requirements)).
  - Constants `RAG_SLASH_COMMAND_REGEX = /^\/rag\s*$/`, `RAG_PALETTE_COMMAND_ID = 'leo-show-rag'`, `RAG_PALETTE_COMMAND_NAME = 'Leo: Show RAG status'` ([OQ-03](../../context.md#open-questions)).
  - `isRagSlashCommand(text)` helper.
- `ChatView.deps` extended with `ragSnapshotCollector?: { collect(signal): Promise<RagSnapshot> }` and (optional) `ragRender?: (snapshot) => void`. The view registers the slash command only when the collector dep is present (mirrors how `analyzeContext` gates `/context` registration).
- `ChatView` slash registry block (currently around `chatView.tsx:534–548`) extended with the `/rag` registration that invokes the command handle, plus a private `renderRagAsWidget(snapshot)` that appends a `role: 'widget'` record with `widget: { kind: 'rag', props: { snapshot } }`.
- Optional palette command registration via `addCommand({ id: 'leo-show-rag', name: 'Leo: Show RAG status', callback: () => handle.invoke() })` — mirrors `CONTEXT_PALETTE_COMMAND_*`.
- `main.ts` wiring: build the F01 collector with the existing `IndexerRagWiring` (`vectorStore`, `vaultIndexer`, `graphCache`, `excludeStore`) plus settings-store accessor for `embeddingModel()`; pass it into `ChatView.deps`.
- Import side effect: ensure `src/ui/chat/widgets/RagWidget.tsx` is imported once at startup so the widget registry contains the `'rag'` kind by the time the message renders. Either via the existing widget barrel or via direct import in the view.
- Tests under `tests/unit/ui/ragCommand.test.ts` covering: invocation appends a single widget message; re-invocation while pending aborts the prior call; collector failure surfaces an obsidian `Notice` (mocked) and does not append a widget.

Out of scope:

- Snapshot computation logic (F01).
- Widget rendering / styling (F02).
- Inline updates of the widget after append (one-shot snapshot per [OQ-01](../../context.md#open-questions)).
- Settings UI / status-bar changes.
- Tab-completion or fuzzy-match changes in the slash picker — `/rag` is picked up automatically via `registry.list()` once registered.

## Acceptance criteria

1. Typing `/rag` (no args) into the composer dispatches the registered slash command, which calls `handle.invoke()`; on success a single new message of role `widget` and `widget.kind === 'rag'` is appended to the active thread's message store ([FR-01](../../context.md#functional-requirements)).
2. The command appears in the slash picker list with description `Show RAG / index status` ([FR-08](../../context.md#functional-requirements)).
3. Re-issuing `/rag` while a collection is in flight cancels the prior `AbortController`; only one widget message is appended (the second one); the first promise resolves to nothing visible to the user ([FR-04 boundary](../../context.md#functional-requirements)).
4. If the collector throws or rejects with a non-abort error, the user sees an obsidian `Notice` text `RAG: <error.message>` and no widget message is appended ([NFR-08](../../context.md#non-functional-requirements)).
5. The command is registered exactly once per `ChatView` lifecycle. Re-opening the chat view does not throw on duplicate-registration because the registry is rebuilt with the view ([NFR-07](../../context.md#non-functional-requirements)).
6. The command palette entry `leo-show-rag` is registered in `main.ts` and triggers the same `handle.invoke()` flow ([OQ-03](../../context.md#open-questions)). If the deps are absent (e.g. provider not configured), the palette command is a no-op without throwing.
7. `main.ts` builds the collector using the existing `IndexerRagWiring` outputs (no duplicate vector-store instances) and passes it via `ChatView.deps`; no platform types leak into `ragCommand.ts` itself ([FR-10](../../context.md#functional-requirements), [layer rule](../../../../architecture/architecture.md#2-layer-diagram)).
8. The widget module (`RagWidget.tsx`) is imported at plugin load so `lookupWidget('rag')` resolves before the first `/rag` invocation; a missing-registration scenario falls back gracefully (existing `MessageList` widget lookup already handles missing kinds).
9. Logging: `info` on slash dispatch, `warn` on collector failure, no `console.log` ([NFR-08](../../context.md#non-functional-requirements), [logging contract](../../../../standards/code-style.md#logging)).
10. Type-check passes (`tsc --noEmit`); ESLint clean; named exports only.

## Dependencies

- Depends on [F01 · rag-snapshot](../rag-snapshot/feature.md) — consumes the collector.
- Depends on [F02 · rag-widget](../rag-widget/feature.md) — relies on its `registerWidget('rag', …)` side effect at import time.
- Depends on context: [FR-01](../../context.md#functional-requirements), [FR-08](../../context.md#functional-requirements), [FR-10](../../context.md#functional-requirements), [NFR-07](../../context.md#non-functional-requirements), [NFR-08](../../context.md#non-functional-requirements).

## Implementation notes

- Mirror the implementation pattern of `src/ui/contextCommand.ts` and `chatView.tsx:534–548` slash registration block — same `AbortController` pattern, same `Notice` error path. See [§4 Key Contracts](../../../../architecture/architecture.md#4-key-contracts) and [§3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views).
- For palette command registration, follow the existing `addCommand` pattern referenced from [tech-stack.md Platform APIs](../../../../standards/tech-stack.md#platform-apis); registration is auto-cleaned on `onunload`.
- Plumbing through `main.ts` follows [§5.1 Plugin Startup](../../../../architecture/architecture.md#51-plugin-startup) — build the collector once, pass it through dep objects to the view.
- Slash registry semantics — duplicate registration throws; this matches the [§7 Error Handling Strategy fail-fast rule](../../../../architecture/architecture.md#7-error-handling-strategy) and [code-style error handling](../../../../standards/code-style.md#error-handling).
- Tests follow [Vitest + happy-dom conventions](../../../../standards/code-style.md#testing-vitest--msw) — no real IDB, no real Obsidian — mock the deps interface from F01.

## Open questions

- **OQ-F03-1** — Should `/rag <subcommand>` (e.g. `/rag refresh`) be reserved now or left as a future extension? Default: leave for later. v1 matches only the bare `/rag`. The `match` predicate enforces `args.length === 0` exactly like `/context`.
- **OQ-F03-2** — Where does the F02 widget module get imported (to trigger its `registerWidget` side effect)? Default: `chatView.tsx` already pulls `ContextWidget`'s effect transitively via the message-list path; mirror that and add a side-effect import in the same place to keep ordering predictable. Verify during implementation.
