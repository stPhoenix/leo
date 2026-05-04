# F14 — Inbox parser + `inbox_add` tool

## Purpose

Parse `wiki-inbox.md` as a markdown checklist of ingest items and offer a read-only `inbox_add(ref, note?)` tool to append entries. Provides the tick / annotate-error primitives consumed by the inbox batch path (F15). Covers [context.md `Inbox`](../../context.md#inbox) FR-07, FR-08, FR-09.

## Scope

- In:
  - Parser turning `wiki-inbox.md` into `{ ref, note?, status:'open'|'done', error?:{code,msg} }` rows; non-matching lines preserved verbatim and ignored on iteration (FR-07).
  - `inbox_add(ref, note?)` registered as `isReadOnly:true` w.r.t. wiki content (it edits the inbox file only); no confirmation required (FR-08).
  - `tick(ref)` — flips `- [ ]` to `- [x]` in place (FR-09).
  - `annotateError(ref, code, msg)` — appends `<!-- error: <code>: <msg> -->` while preserving the unticked checkbox (FR-09).
- Out: actually invoking ingest from inbox (F15); cleanup of ticked items.

## Acceptance criteria

1. Parser round-trips: parse → serialize preserves byte-identity for non-matching lines (FR-07).
2. `inbox_add` registered with `isReadOnly:true`, `requiresConfirmation:false`; appends one well-formed line (FR-08).
3. `tick(ref)` is idempotent; ticking an already-ticked line is a no-op (FR-09).
4. `annotateError(ref, code, msg)` does not flip checkbox state (FR-09).
5. Unit tests cover parse, parse + tick, parse + annotate, and idempotency.

## Dependencies

- F01 (`wiki-inbox.md` exists).
- Anchors: [context.md `Inbox`](../../context.md#inbox).

## Implementation notes

- `inbox_add` is a built-in `ToolSpec` (`source:"builtin"`) per [architecture.md §4](../../../../architecture/architecture.md#4-key-contracts). It sets `requiresConfirmation:false`, deviating from the §4 default (`true` for write-tools) because SRS FR-WIKI-08 explicitly classifies the inbox edit as low-risk additive — documented deviation, not silent.
- Modules at `src/agent/wiki/inbox/parse.ts` + `src/agent/wiki/inbox/inboxAddTool.ts` per [project-structure.md](../../../../standards/project-structure.md).
- Atomic per-file writes via `VaultAdapter` per [architecture.md §3.4](../../../../architecture/architecture.md#34-adapters) and [tech-stack.md `Platform APIs`](../../../../standards/tech-stack.md).
- Parser is pure; trivially unit-testable per [code-style.md `Testing (Vitest + msw)`](../../../../standards/code-style.md).

## Open questions

- OQ-3 — `/wiki-inbox-clean` deferred per [context.md `Open questions`](../../context.md#open-questions).
