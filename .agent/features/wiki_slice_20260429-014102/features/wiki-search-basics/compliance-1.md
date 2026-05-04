# Compliance iteration 1 — F02 wiki-search-basics

## Acceptance criteria
- AC1: PASS — `searchWiki.ts:55-66` sets `requiresConfirmation:false`, `isReadOnly:true`, `source:'builtin'`. Registered at `main.ts:923-924`. Test `tests/unit/searchWikiTool.test.ts` "registered as read-only…".
- AC2: PASS — `searchWiki.ts:73-78` reads `WIKI_INDEX_PATH` first, then iterates `topNCandidates(...,maxMatches)` (default 8). Test "reads wiki/index.md first…" + "caps matches to N=8 default".
- AC3: PASS — `searchWiki.ts:80-91` reads candidate body via `deps.vault.read(c.path)`; entries that point inside `wiki/raw/` are skipped explicitly (`c.path.startsWith('wiki/raw/')`). Test asserts `vault.opened.some((p) => p.startsWith('wiki/raw/')) === false`.
- AC4: PASS — `searchWiki.ts:94` runs `SearchWikiResultSchema.parse(...)` before returning; schema enforces `indexConsulted: true` literal, max-N matches, strict object. Throw inside try/catch → `{ok:false,error:msg}`.
- AC5: PASS — `LEO_PREAMBLE` (`agent/types.ts`) now contains "Wiki vs lifestream routing", "prefer `search_wiki`", "prefer `search_vault`", and "fall back to `search_vault`" lines. Test "LEO_PREAMBLE includes wiki vs lifestream routing rule + fallback wording".
- AC6: PASS — `tests/unit/wikiIndexReader.test.ts` covers parse + lexical scoring + max-N truncation; `tests/unit/searchWikiTool.test.ts` covers tool round-trip with fake `VaultAdapter`.

## Scope coverage
- In scope "search_wiki registered with isReadOnly:true, requiresConfirmation:false (FR-11)": PASS — flags asserted in test.
- In scope "Index-first lexical match (default N=8); read matched page bodies; never read raw/ (FR-12)": PASS — see AC2/AC3.
- In scope "Result Zod-validated against SearchWikiResult shape (FR-12)": PASS — `SearchWikiResultSchema` strict, validated on every return path.
- In scope "Extension of LEO_PREAMBLE with routing rule + empty-match fallback (FR-13)": PASS — see AC5.

## Out-of-scope audit
- Out of scope "in-progress warning (F07)": CLEAN — no warning text injected, no Notice surfaced from search_wiki.
- Out of scope "BM25 / vector search": CLEAN — only lexical token scoring.
- Out of scope "scope arg": CLEAN — `SearchWikiSchema` accepts only `{query}`.

## QA aggregate
QA verdict: PASS (typecheck/lint/2100 tests/build all PASS).

## Integration notes
- `searchWiki.ts` wired from `main.ts:923-924` (`createSearchWikiTool` + `toolRegistry.register`).
- `indexReader.ts` reached via `searchWiki.ts` (one hop) and exercised by tests directly.
- `paths.ts` reached via `searchWiki.ts` and `bootstrap.ts` (already PASSed F01); `WIKI_INDEX_PATH` referenced in test.
- No stub bodies (§5.3.2): all functions have real implementations; tool returns either `{ok:true,data:…}` from a populated path or `{ok:false,error:…}` on signal/exception.

## Verdict: PASS
