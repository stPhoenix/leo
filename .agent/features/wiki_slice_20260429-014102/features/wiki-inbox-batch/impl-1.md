# Impl iteration 1 — F15 wiki-inbox-batch

## Summary
Added the `kind:'inbox'` discriminator to `delegate_wiki_ingest` and the orchestrator that drains `wiki-inbox.md` sequentially. Each open row resolves to a `IngestSource` via `inferSource`; per item, F11's `startIngestRun` runs to terminal; outcomes flip the row to `[x]` (DONE), annotate with `<!-- error: <code>: <msg> -->` (ERROR/busy), or break out of the loop (CANCELLED). Tool result shape now carries either a `single` mode (`IngestTerminalResult`) or an `inbox` mode (`InboxBatchResult` with per-item statuses).

## Files touched
- `src/agent/wiki/ingest/inboxBatch.ts` — `runInboxBatch(threadId, signal, deps)`, `inferSource(ref, note?)`, `InboxBatchResult` shape.
- `src/tools/builtin/delegateWikiIngest.ts` — added `InboxInput` Zod variant; tool now exposes `inbox` dep `{vault, logger?}`; result shape extended via `DelegateWikiIngestSuccessPayload = {mode:'single', terminal} | {mode:'inbox', batch}`.
- `src/main.ts` — passes `inbox: { vault: vaultAdapter, logger: this.logger }` into the tool factory.

## Tests added or updated
- `tests/unit/wikiInboxBatch.test.ts` — `inferSource` URL/attachment/vaultPath/empty cases; sequential drain ticks success + annotates two distinct error codes (AC1/AC2/AC3); pre-aborted signal cancels batch before any startRun (AC5); empty/missing inbox returns drained:0.
- `tests/unit/wikiIngestTool.test.ts` — updated existing single-mode happy path to assert the new `{mode:'single', terminal}` payload.

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
- Cancel test uses a pre-aborted signal rather than mid-iteration abort (which would require coordinating async timing with `startRun` resolution). The semantic — "aborted signal stops batch immediately, no further startRun calls" — is verified.
- Per-item duplicate-detect interrupts (AC4) reuse F11's controller path: each iteration creates a controller, registers it in `liveControllerRegistry`, and the duplicate prompt flows through whatever `requestDuplicateChoice` callback is wired (today: always `'skip'`). When that callback is wired to the F06 widget's awaiting_duplicate phase, inbox items will pause identically to single-source ingest. Deferred coordination noted.

## Assumptions
- `inferSource` heuristic: `https?://` → URL; `attachment:` → attachment; otherwise vault path. The user can override via `note` if needed.
- `busy` outcomes (mutex held by another op) write the same `<!-- error: busy: ... -->` annotation as fetch errors. Mid-batch this should be impossible because the same orchestrator serialises starts; included for defensive behaviour.

## Open questions
None.
