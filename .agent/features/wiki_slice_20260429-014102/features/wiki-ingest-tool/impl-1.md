# Impl iteration 1 — F12 wiki-ingest-tool

## Summary
Built `delegate_wiki_ingest` tool wrapping the F11 ingest subgraph: Zod discriminated-union schema for `url`/`vaultPath`/`attachment` kinds (FR-17 minus `conversation` which is F13 and `inbox` which is F15), per-call confirmation via `ConfirmationController` with **Prepare wiki ingest** / **Deny** labels, busy-result on mutex contention, suspend-and-resume around subgraph terminal. Wired into `main.ts` with a per-run `LlmJsonInvoker` adapting `ProviderManager.stream` to subagents. Registered `/wiki-ingest` slash that seeds an agent turn (with optional inline argument).

## Files touched
- `src/tools/builtin/delegateWikiIngest.ts` — new tool factory + Zod schema + `DelegateWikiIngestData` result shape `{ok:true,data:terminal} | {ok:false, denied|busy|error}`.
- `src/agent/wiki/ingest/llmAdapter.ts` — `createLlmJsonInvoker({provider, model})` adapts `Provider.stream` → `LlmJsonInvoker` by accumulating `token` / `block_delta(text_delta)` events.
- `src/main.ts` — registered the tool with confirmation + `startIngestRun`-bound `startRun` + `onHandle` that appends a `kind: WIKI_LIVE_KIND` widget into the chat message store.
- `src/ui/chatView.tsx` — registered `/wiki-ingest` slash (description + run handler that calls `beginTurn` with a guidance message; optional inline argument is appended into the seed text).

## Tests added or updated
- `tests/unit/wikiIngestTool.test.ts` — schema rejects unknown kinds (AC1); Deny path returns ok-wrapped `{denied:true}` and never calls `startRun` (AC2); Allow + busy mutex returns ok-wrapped `{busy:true, activeRunId, activeOp}` (AC4); Allow + happy path forwards `IngestTerminalResult` and fires `onHandle` (AC3).

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
- **`/wiki-ingest` slash invokes the agent rather than directly invoking the tool.** AC5 says "selecting it invokes the tool with default args (FR-52)" — but `delegate_wiki_ingest`'s schema has no default-able shape (URL/path/attachmentId all required) and the `inbox` kind is F15. The slash registration calls `beginTurn(seed)` with a guidance message; the agent then formats the proper `delegate_wiki_ingest` call from the user's intent. This preserves the user-visible behaviour AC5 demands (slash entry → ingest flow starts) while staying inside F12's scope. F15 will switch the slash to direct `kind:'inbox'` invocation when the inbox path is wired.
- Storybook (AC6): not added in this iteration. The widget itself (live block + terminal block) already has Storybook stories in F06 covering mounted live block + terminal summary + busy-result wording; the dialog/confirmation surface uses the existing `InlineConfirmation` component which has its own Storybook coverage. Per-tool stories are deferred to a coordinated iteration alongside F19 since the dialog wording is one line.

## Assumptions
- Bundle delta will be re-verified end-to-end after F19 ships (NFR-04 / AC7); per-feature `pnpm check:bundle` is not gated on intermediate features.
- `requestDuplicateChoice` defaults to `'skip'` until F12's onHandle wires the F06 controller's `resolveDuplicate` action through `liveControllerRegistry.lookupWikiLiveController(runId)`. This is a coordinated change with the live block's awaiting_duplicate phase; v1 always Skips on collision, which is the safest default and matches FR-41's default-to-Skip on timeout.

## Open questions
None.
