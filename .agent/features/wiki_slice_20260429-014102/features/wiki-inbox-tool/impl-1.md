# Impl iteration 1 — F14 wiki-inbox-tool

## Summary
Implemented the wiki-inbox parser + `inbox_add` built-in tool. `parseInbox` turns `wiki-inbox.md` into typed `InboxRow` records (open/done + ref + note + error), preserves non-matching lines verbatim, and exposes `appendRow`, `tickRef`, `annotateErrorOnRef` primitives consumed by F15. The tool is `isReadOnly:true` + `requiresConfirmation:false` (FR-08), wired in `main.ts`.

## Files touched
- `src/agent/wiki/inbox/parse.ts` — `InboxRow`, `ParsedInbox`, `parseInbox`, `serializeInbox`, `renderRow`, `appendRow`, `tickRef`, `annotateErrorOnRef`.
- `src/tools/builtin/inboxAdd.ts` — `createInboxAddTool({vault})`, Zod schema `{ref, note?}`, `INBOX_ADD_TOOL_ID = 'inbox_add'`.
- `src/main.ts` — import + `toolRegistry.register(createInboxAddTool({vault: vaultAdapter}))` between delegate_wiki_ingest and TodoWrite.

## Tests added or updated
- `tests/unit/wikiInbox.test.ts` — 13 cases: parse open/done rows + ignores non-matching lines (FR-07); serialize round-trip preserves byte-identity for non-row lines (AC1); error annotation parsed independently of note; appendRow shape; tickRef flips, idempotent, no-op for unknown ref (AC3); annotateErrorOnRef preserves checkbox state on open + done (AC4); tool registered with read-only/no-confirm/builtin flags (AC2); appends one well-formed line (AC2); preserves existing content.

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
None.

## Assumptions
- Both note and error annotations use the `<!-- ... -->` HTML comment form. The parser distinguishes by trying the `error: <code>: <msg>` regex first; remaining comments are noted plain.
- `inbox_add` writes the entire inbox file via `vault.write` (Obsidian's adapter is the source of atomicity). No diff/patch — simpler and safer for a single-line append.

## Open questions
- OQ-3 — `/wiki-inbox-clean` for archiving ticked items deferred per spec.
