# Impl iteration 1 — F02 wiki-search-basics

## Summary
Built `search_wiki` read-only built-in tool with index-first match, Zod-validated `{indexConsulted, matches[]}` shape, default N=8 cap, and registered it in `ToolRegistry` from `main.ts`. Extended `LEO_PREAMBLE` with the wiki-vs-lifestream routing rule and empty-match fallback to `search_vault`.

## Files touched
- `src/agent/wiki/indexReader.ts` — pure parser/scorer/snippet helpers; `parseWikiIndex`, `scoreEntries`, `topNCandidates`, `buildSnippet`, `summarizeFromBody`, `WIKI_SEARCH_DEFAULT_N=8`. Index paths normalized to `wiki/...`.
- `src/tools/builtin/searchWiki.ts` — `createSearchWikiTool({vault, maxMatches?})`, Zod arg + result schemas, `isReadOnly:true`, never opens `wiki/raw/`.
- `src/agent/types.ts` — `LEO_PREAMBLE` now multi-line, includes Wiki vs lifestream routing rule + empty-match fallback wording.
- `src/main.ts` — import + register `search_wiki` tool right after `search_vault`.

## Tests added or updated
- `tests/unit/wikiIndexReader.test.ts` — parses category headings + bullet wikilinks, alias form, skips non-wikilink lines; scoring drops zero-score, ranks title hits over summary, topN truncation, default N=8; snippet centring; summary respects frontmatter block.
- `tests/unit/searchWikiTool.test.ts` — read-only/no-confirm/builtin flags (AC1); reads `wiki/index.md` first then page bodies, never opens `wiki/raw/` (AC2/AC3); N=8 cap; graceful empty result when index missing; abort signal honoured; LEO_PREAMBLE includes routing rule (AC5).

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
None.

## Assumptions
- Lexical scoring weights: title 3, summary 1, category 1, substring 0.5. Picked to give reasonable AC2 ranking; any reducer/lint pass can tune.
- Snippet length 240 chars by default. Narrow enough for prompt context; not a spec'd value.

## Open questions
None (OQ-1 explicitly deferred per feature.md).
