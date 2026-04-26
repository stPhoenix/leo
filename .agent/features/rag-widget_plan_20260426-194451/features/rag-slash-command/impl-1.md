# Impl iteration 1 — F03 rag-slash-command

## Summary

Wired the `/rag` slash command end-to-end. Added `src/ui/ragCommand.ts` (mirrors `contextCommand.ts`), registered the slash command in `ChatView` next to `/context`, plumbed the F01 collector from `main.ts` through `ChatView.deps.collectRagSnapshot`, and added a palette entry `Leo: Show RAG status` that opens or focuses the chat view and triggers the same handle.

## Files touched

- `src/ui/ragCommand.ts` — new file: `RagCommandDeps`, `RagCommandHandle`, `createRagCommand(deps)` with the same `AbortController`-aware shape as `createContextCommand`; constants `RAG_SLASH_COMMAND_REGEX`, `RAG_PALETTE_COMMAND_ID`, `RAG_PALETTE_COMMAND_NAME`; helper `isRagSlashCommand(text)`.
- `src/ui/chatView.tsx` — added `collectRagSnapshot` dep, `ragCommand: RagCommandHandle | null` field, `triggerRagSlash()` public method, slash registration block at the same locus as `/context`, `renderRagAsWidget(snapshot)` private helper that appends a `role: 'widget'` record with `widget: { kind: 'rag', props: { snapshot } }`, and `onClose` cleanup that calls `ragCommand?.cancel()` and nulls the handle.
- `src/main.ts` — imported `IndexerStatusTap`, `createRagSnapshotCollector`, `RagSnapshotCollector`, `RAG_PALETTE_COMMAND_ID`, `RAG_PALETTE_COMMAND_NAME`. Added `indexerStatusTap`, `ragCollector`, `vectorStoreUnavailableReason`, `vectorStoreCorruptionUnsub` private fields. After `wireIndexerRag`, instantiated the tap (subscribed to `vaultIndexer`), subscribed to `vectorStore` corruption events to keep the latest reason, and built the snapshot collector. Passed `collectRagSnapshot` into the chat view deps. Registered the palette command (`leo-show-rag` / `Leo: Show RAG status`) that opens or focuses the chat leaf and calls `view.triggerRagSlash()`. Disposed the tap and unsubscribed from corruption events in `onunload`.
- `tests/unit/ragCommand.test.ts` — new file (6 tests).

## Tests added or updated

- `tests/unit/ragCommand.test.ts` covers `isRagSlashCommand` (matches bare `/rag` with optional whitespace, rejects args / unrelated commands), `createRagCommand.invoke` (renders the snapshot from the collector — AC1; reports collector errors via `onError` without rendering — AC4; cancels prior in-flight invocation so only the second renders — AC3 boundary; `cancel()` aborts in-flight without firing onError — also AC3).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- Test file location: spec suggests `tests/unit/ui/ragCommand.test.ts`. Existing project layout is flat (`tests/unit/contextCommand.test.ts` would-be / actually `tests/unit/agentRunner.test.ts`, `vaultIndexer.test.ts`, etc.); the new test follows the flat pattern as `tests/unit/ragCommand.test.ts`.
- Resolved `OQ-F03-1` ("/rag <subcommand>") in favour of "no" — `RAG_SLASH_COMMAND_REGEX` matches `/rag` with optional trailing whitespace only. Default match in the slash registry already enforces zero args, so the regex constant is exported only for future palette/keybinding wiring.
- Resolved `OQ-F03-2` ("widget side-effect import location") — the side-effect import `import './chat/widgets/RagWidget'` was added to `src/ui/chatView.tsx` in F02 next to the existing `ContextWidget` import, mirroring the established pattern. F03 keeps that import in place; no change needed here.

## Assumptions

- `VectorStore.subscribe` is the canonical channel for corruption-reason updates; capturing the latest reason in a single field is enough to surface a meaningful message in the unavailable variant. If the store recovers (re-opens cleanly), `isAvailable()` returns true and the unavailable branch never fires, so a stale reason is not visible to the user.
- `ChatView.triggerRagSlash()` is a thin public method intended only for the palette command. It is a no-op when the chat view's `ragCommand` is `null` (e.g. the deps did not include the collector).
- Palette command callback opens or focuses the chat view first (via `openOrFocusChatView`) and then dispatches to the `ChatView` instance found via `getLeavesOfType`. Same pattern as the existing `Leo: Open chat` command.

## Open questions

None blocking. Future enhancement: register a settings-driven default keybinding for `/rag`. Out of scope for v1.
