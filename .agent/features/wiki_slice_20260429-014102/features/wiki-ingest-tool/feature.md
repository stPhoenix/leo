# F12 — `delegate_wiki_ingest` tool + `/wiki-ingest` slash

## Purpose

The agent-facing surface that wraps the ingest subgraph: a `requiresConfirmation:true` built-in tool, a `/wiki-ingest` slash command, busy-result behavior when the wiki mutex is held, suspend-and-resume around the subgraph terminal. Covers [context.md `Ingest Trigger & Confirmation`](../../context.md#ingest-trigger--confirmation) FR-15..FR-19, the bundle constraint [NFR-04](../../context.md#non-functional-requirements), and the `/wiki-ingest` half of FR-52.

## Scope

- In:
  - `delegate_wiki_ingest(input)` registered with `requiresConfirmation:true` (FR-15, FR-16).
  - Input Zod-typed for `url` / `vaultPath` / `attachment` kinds (FR-17 — `conversation` is F13, `inbox` is F15).
  - Confirmation actions: **Prepare wiki ingest** / **Deny** via `confirmationController` (FR-16).
  - Deny → `{ ok:false, denied:true }` (FR-18).
  - Prepare → mount widget block + suspend tool until subgraph terminal (FR-19).
  - On busy mutex → `{ ok:false, error:'busy', activeRunId, activeOp }` without mounting widget (FR-24).
  - On terminal DONE → `{ ok:true, ingestId, sources, pagesCreated, pagesEdited, durationMs }` (FR-33).
  - `/wiki-ingest` slash invokes the tool with default args (FR-52).
- Out: conversation-kind input (F13); inbox batch (F15).

## Acceptance criteria

1. Tool registered with `requiresConfirmation:true` and Prepare/Deny actions (FR-15, FR-16).
2. Deny returns `{ ok:false, denied:true }`; main agent continues normally (FR-18).
3. Prepare mounts the F06 widget block + suspends; the tool resumes on subgraph terminal (FR-19, FR-33).
4. Busy mutex → busy result, no widget mounted, main agent surfaces a user-visible message (FR-24).
5. `/wiki-ingest` slash entry visible in picker; selecting it invokes the tool with default args (FR-52).
6. Storybook covers: confirmation prompt (idle / pending), busy-result render, mounted live block, terminal summary.
7. Bundle delta from F12 + dependencies, when added to the running slice total, fits within ≤ 40 KB minified `main.js` budget (NFR-04). Verified via `pnpm check:bundle` after F19 lands.

## Dependencies

- F11 (ingest subgraph + RunHandle).
- Anchors: [context.md `Ingest Trigger & Confirmation`](../../context.md#ingest-trigger--confirmation), [context.md `Non-functional requirements`](../../context.md#non-functional-requirements).

## Implementation notes

- Tool registered as a built-in `ToolSpec` (`source:"builtin"`, `requiresConfirmation:true`, `schema:` Zod discriminated union, `invoke(input,ctx)`) per [architecture.md §4](../../../../architecture/architecture.md#4-key-contracts); pattern mirrors `src/tools/builtin/delegateExternal.ts` per [project-structure.md](../../../../standards/project-structure.md).
- Confirmation flow rides the existing `tool_confirmation` stream-event path documented in [architecture.md §5.3](../../../../architecture/architecture.md#53-chat-turn-with-tool-call--confirmation), via `confirmationController` at `src/agent/confirmationController.ts` per [project-structure.md](../../../../standards/project-structure.md).
- Tool result shape `{ ok:true, data }` / `{ ok:false, error|cancelled|denied|busy }` per [architecture.md §4](../../../../architecture/architecture.md#4-key-contracts) `ToolResult` and [code-style.md `LangGraph / Agent Layer`](../../../../standards/code-style.md) — no thrown errors leave the tool.
- Slash command registration at `src/ui/chat/slashCommands.ts` per [project-structure.md](../../../../standards/project-structure.md); slash entry calls the tool with default args — UI never invokes the subgraph directly per [architecture.md §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views).
- Plugin-unload cancellation rides the global `AgentRunner` cancel path per [architecture.md §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules); the wiki mutex releases via the F11 outer `finally`.
- Bundle baseline guard `pnpm check:bundle` per [project-structure.md `Test suites`](../../../../standards/project-structure.md).

## Open questions

- None.
