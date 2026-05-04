# F03 — `/wiki-status` slash command

## Purpose

A read-only, one-call summary of wiki health surfaced through the composer's slash picker. Covers [context.md `Slash Commands`](../../context.md#slash-commands) FR-52 (status part).

## Scope

- In:
  - Register `/wiki-status` in the composer slash registry.
  - Tool/handler that reads `wiki/index.md` size, last lint timestamp from `wiki/log.md`, current orphan count via a small adjacency walk, and current `WikiMutex.active()` state.
  - Result rendered as a plain markdown chat block.
- Out: any mutating action, settings UI, periodic refresh.

## Acceptance criteria

1. `/wiki-status` is visible in the slash picker after plugin load (FR-52).
2. Invocation is read-only; no `requiresConfirmation` (FR-52).
3. Result lists: index page count, index size in bytes, last lint timestamp (or `never`), live orphan-page + orphan-raw count, and current mutex state (`idle` / `ingest <runId>` / `lint <runId>`) (FR-52).
4. Last-lint timestamp is parsed from the most recent `## [<iso>] lint | runId=<id>` line in `wiki/log.md` (FR-52).
5. Storybook covers picker entry visible / selected and a sample result block.

## Dependencies

- F01 (layout + log file exist).
- F02 (`search_wiki` proves the tool registration pattern; not a hard runtime dep).
- Anchors: [context.md `Slash Commands`](../../context.md#slash-commands).

## Implementation notes

- Slash registers in the composer (`src/ui/chat/slashCommands.ts`) and dispatches to a built-in `wiki_status` `ToolSpec` (`source:"builtin"`, `requiresConfirmation:false`) per [architecture.md §4](../../../../architecture/architecture.md#4-key-contracts) — UI never reads vault state directly per [architecture.md §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views).
- Tool reads `wiki/index.md`, `wiki/log.md`, scan-helper output, and `WikiMutex.active()` via `ToolCtx.vault` plus module imports kept inside the agent layer.
- Result rendering reuses the existing `AssistantBlocks` chat path per [tech-stack.md `UI Layer`](../../../../standards/tech-stack.md).
- `Notice` is not used here — the chat block is the surface, per [tech-stack.md `Platform APIs`](../../../../standards/tech-stack.md).

## Open questions

- OQ-4 — surface "last lint was N days ago" hint inline in the result; recommend yes per [context.md `Open questions`](../../context.md#open-questions).
