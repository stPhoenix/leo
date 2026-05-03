# F16 — Lint SCANNING phase

## Purpose

Build the lint subgraph's first phase: enumerate the agent-owned, lint-eligible surface (`pages/` + `sources/`), build wikilink adjacency, and identify orphan pages and orphan raw entries. Covers [context.md `Lint Subgraph — Phases`](../../context.md#lint-subgraph--phases) FR-34.

## Scope

- In:
  - Enumerate `wiki/pages/` and `wiki/sources/` only (FR-34).
  - Build wikilink adjacency `Map<path, Set<targetPath>>`; symmetric merge of forward + back-links (mirrors lifestream `GraphCache`).
  - Count inbound + outbound refs per page; identify orphan pages (zero inbound) and orphan raw entries (no `sources/` summary references them) (FR-34).
  - Pass `SCHEMA.md` content to checkers as read-only input (FR-34).
  - Skip `index.md`, `log.md`, `introduction.md` — never enumerated by lint (FR-34).
- Out: checker logic (F17), proposing/writing/UI.

## Acceptance criteria

1. SCANNING enumerates only `wiki/pages/` + `wiki/sources/` (FR-34).
2. `index.md` / `log.md` / `introduction.md` are not enumerated and never modified by lint (FR-34).
3. `SCHEMA.md` is read once and made available to subsequent CHECKING (FR-34).
4. Adjacency is the symmetric merge of `MetadataCache.resolvedLinks` forward + back-links.
5. Orphan-raw detection identifies `wiki/raw/<x>` files with no matching `sources/` summary citation.
6. Unit test: synthetic vault with two pages cross-linked + one orphan + one orphan raw produces the expected adjacency + orphan lists.

## Dependencies

- F01 (layout + initial seeded files).
- Anchors: [context.md `Lint Subgraph — Phases`](../../context.md#lint-subgraph--phases).

## Implementation notes

- Reuse `MetadataCache.resolvedLinks` first via `GraphCache` (the canonical adjacency adapter per [architecture.md §3.4](../../../../architecture/architecture.md#34-adapters)); fall back to direct `MetadataCache` reads only when missing.
- Pure scan node — IO confined to module entry per [architecture.md §3.3](../../../../architecture/architecture.md#33-domain--core-pure) and [code-style.md `LangGraph / Agent Layer`](../../../../standards/code-style.md).

## Open questions

- None.
