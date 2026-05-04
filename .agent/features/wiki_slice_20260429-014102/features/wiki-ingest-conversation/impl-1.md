# Impl iteration 1 — F13 wiki-ingest-conversation

## Summary
Extended `delegate_wiki_ingest` schema with `{kind:'conversation', title, body, threadId, turnIndex, citedSources?, note?}` and updated tool description to instruct the agent that conversation answers/analyses can be filed back as wiki pages. Runtime works with no driver changes — F08's `fetchIngestSource` already handles the conversation kind by returning a synthetic `FetchedSource` with `sourceRef='conversation:<threadId>:<turnIndex>'`, and the rest of the pipeline (sha256 → persist → plan → extract → reduce → write) runs unchanged.

## Files touched
- `src/tools/builtin/delegateWikiIngest.ts` — added `ConversationInput` Zod variant; updated description; updated `argsToSource` and `describeArgsAsAsk` switches.

## Tests added or updated
- `tests/unit/wikiIngestConversation.test.ts` — schema accepts conversation input (AC1); description mentions conversation (AC4); tool forwards a conversation-shaped `IngestSource` into `startRun.sources[0]` (AC1/AC3); processSourceFetchPersist persists raw with `source: "conversation:<thread>:<turn>"` and dated path (AC2/AC5).

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
None.

## Assumptions
- `threadId` and `turnIndex` are required fields on the conversation input. The agent supplies them from `ToolCtx.thread` and the current turn index. Without these, the resulting raw entry would not be uniquely traceable to the conversation it came from — making `citedSources` enforcement and re-ingest detection unreliable.

## Open questions
None.
