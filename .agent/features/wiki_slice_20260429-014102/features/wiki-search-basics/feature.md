# F02 — `search_wiki` tool + LEO_PREAMBLE routing

## Purpose

Give the main agent a read-only retrieval tool that consults `wiki/index.md` first, returns up to N=8 page matches, and lives behind a routing rule baked into the always-on system preamble. Covers [context.md `Routing & Wiki Search`](../../context.md#routing--wiki-search) FR-11, FR-12, FR-13.

## Scope

- In:
  - `search_wiki(query, opts?)` registered in `ToolRegistry` (`isReadOnly:true`, `requiresConfirmation:false`) (FR-11).
  - Index-first lexical match (default N=8); read matched page bodies; never read `raw/` (FR-12).
  - Result Zod-validated against `SearchWikiResult` shape `{ indexConsulted: true, matches: [{path, summary, snippet, score}] }` (FR-12).
  - Extension of `LEO_PREAMBLE` in `src/agent/types.ts` with the knowledge-vs-lifestream routing rule and empty-match fallback to `search_vault` (FR-13).
- Out: in-progress warning (F07); BM25 / vector search; scope arg.

## Acceptance criteria

1. Tool registered at plugin load with the correct flags (FR-11).
2. Tool reads `wiki/index.md` first; picks ≤ N=8 candidates by lexical/heuristic match (FR-12).
3. Each candidate body is read via `VaultAdapter`; `raw/` files are never opened (FR-12).
4. Tool result is Zod-validated; non-conforming output never reaches the agent.
5. `LEO_PREAMBLE` includes the routing rule wording and the empty-match fallback (FR-13).
6. Unit tests cover `indexReader` parse + lexical scoring + max-N truncation; integration test covers tool round-trip with fake `VaultAdapter`.

## Dependencies

- F01 (vault layout + seeded `index.md` exist).
- Anchors: [context.md `Routing & Wiki Search`](../../context.md#routing--wiki-search).

## Implementation notes

- `search_wiki` is registered in `ToolRegistry` as a built-in `ToolSpec` (`source:"builtin"`, `requiresConfirmation:false`) per [architecture.md §4](../../../../architecture/architecture.md#4-key-contracts); pattern mirrors `src/tools/builtin/searchVault.ts` per [project-structure.md](../../../../standards/project-structure.md).
- Tool reads vault state via `ToolCtx.vault` (`VaultAdapter`) per [architecture.md §4](../../../../architecture/architecture.md#4-key-contracts) — no direct `app.vault` access.
- `LEO_PREAMBLE` source-of-truth lives in `src/agent/types.ts`; `ContextAssembler` consumes it per [architecture.md §3.3](../../../../architecture/architecture.md#33-domain--core-pure).
- Zod `.parse()` at adapter boundary per [code-style.md `Zod & Tool Schemas`](../../../../standards/code-style.md).
- `indexReader` is pure — testable without IO per [code-style.md `Testing (Vitest + msw)`](../../../../standards/code-style.md).

## Open questions

- OQ-1 — optional `scope: 'pages'|'sources'|'all'` arg deferred per [context.md `Open questions`](../../context.md#open-questions).
