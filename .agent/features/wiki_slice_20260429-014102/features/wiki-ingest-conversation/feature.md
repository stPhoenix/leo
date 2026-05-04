# F13 — Conversation-kind ingest path

## Purpose

Extend `delegate_wiki_ingest` with a conversation input variant that files an answer/analysis from the current chat thread back into the wiki as a new page, compounding the wiki from exploration and not just from external sources. Covers [context.md `Ingest Trigger & Confirmation`](../../context.md#ingest-trigger--confirmation) FR-17 (conversation kind specifics).

## Scope

- In:
  - Extend tool input union with `{ kind:'conversation', title:string, body:string, citedSources?:string[], note?:string }`.
  - PERSISTING branch: write raw with `source: 'conversation:<threadId>:<turnIndex>'`, sha256 over body (FR-17).
  - FETCHING is bypassed for conversation kind (FR-17).
  - PLANNING / EXTRACTING / REDUCING / WRITING run unchanged.
  - Tool description prompts the main agent to file conversation answers/analyses back as wiki pages.
- Out: any new UI; conversation auto-attach (out per [context.md `Out of scope`](../../context.md#out-of-scope)).

## Acceptance criteria

1. Tool accepts the conversation input shape; Zod-validated (FR-17).
2. FETCHING is skipped; PERSISTING produces a raw with the required frontmatter (FR-17).
3. Remaining phases run unchanged; the resulting page(s) appear under `wiki/pages/`.
4. Tool description includes the explicit instruction to consider conversation-back-fill as a valid use case (FR-15).
5. Unit test: invoking with conversation input writes raw + at least one page, no FETCHING is observed in a mock fetch spy.

## Dependencies

- F12 (tool surface).
- Anchors: [context.md `Ingest Trigger & Confirmation`](../../context.md#ingest-trigger--confirmation).

## Implementation notes

- Conversation kind is an additional discriminator on the `delegate_wiki_ingest` `ToolSpec.schema` from F12; same `ToolSpec` registration rules apply per [architecture.md §4](../../../../architecture/architecture.md#4-key-contracts).
- Branch lives in `src/agent/wiki/ingest/fetch.ts` + `persist.ts` per [project-structure.md](../../../../standards/project-structure.md).
- Zod discriminated union extension per [code-style.md `Zod & Tool Schemas`](../../../../standards/code-style.md).

## Open questions

- None.
