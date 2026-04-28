# Compliance iteration 1 — F33 rag-tag-filter-search-vault

## Acceptance criteria

- AC1: PASS — `RAGEngine.query(text, {tags})` normalises `tags` and filters rows after exclude / before `selectTopK` at `src/rag/ragEngine.ts:96-109`; when `normalisedTags.length === 0` the path short-circuits to the F31 scan with `rows = afterExclude`. Asserted by `tests/unit/ragEngine.test.ts` "tags:[] is strictly equivalent to no tags filter (byte-identical)" (`JSON.stringify` equality) and "tag-filter preserves F31 top-K ordering on unfiltered runs (snapshot byte-identity)".
- AC2: PASS — `src/rag/tagMatcher.ts:26-44` implements `matches(chunkTags, requested): boolean` with empty-requested short-circuit, `#`-strip + lowercase + trim normalisation, and type-guarded iteration that returns `false` on malformed entries. Asserted by `tests/unit/tagMatcher.test.ts` 11 `matches` cases (empty-requested, single frontmatter, single inline, multi, zero-intersection, case-insensitive, `#`-strip symmetric, frontmatter-only, inline-only, union, malformed-safe) + `normalizeTag` + `normalizeTags` matrices.
- AC3: PASS — tag-filtered rows are excluded from the array handed to `selectTopK` (`src/rag/ragEngine.ts:104`) so cosine is never called on them. Asserted by `tests/unit/ragEngine.test.ts` "tags filter rejects rows before cosine — never enter top-K" (100 rows, 10 tagged → `hits.length === min(10, DEFAULT_TOP_K) === 10`; all hit paths have index `< 10`).
- AC4: PASS — `src/tools/builtin/searchVault.ts:26-90` exports `createSearchVaultTool(engine)` returning a `ToolSpec<SearchVaultArgs, SearchVaultResult>` with `id='search_vault'`, `requiresConfirmation: false`, `source: 'builtin'`, JsonSchema `{query: string, tags?: string[]}` + `required: ['query']`, `invoke` calling `engine.query(args.query, {tags?, signal})` and returning `{ok:true,data:{hits}}` or `{ok:false,error}` on thrown exception. Runtime `Plugin.onload` `ToolRegistry.register` wiring parked alongside main.ts integration slice. Asserted by `tests/unit/searchVault.test.ts` "spec shape" + "invoke happy path" + "invoke empty hits is still ok:true (never tool-error)" + "invoke catches thrown exception from engine and returns {ok:false,error}".
- AC5: PASS — validator rejects missing/empty/non-string `query` (`searchVault.ts:52-55`) without invoking engine; rejects non-array `tags` and non-string entries (`:57-65`). `tags:[]` and omitted `tags` both map to "no filter" via the RAGEngine normalisation path (AC1 byte-identity). Asserted by `tests/unit/searchVault.test.ts` "validate rejects missing query" (3 variants) + "validate rejects non-string entries in tags" + "validate rejects tags that is not an array" + "validate accepts tags:[] as well as omitted tags".
- AC6: PASS — `src/agent/agentRunner.ts:212-226` runs `this.ragEngine.query(slot.input.message.content, {signal: slot.abort.signal})` once per turn before `assembleContext`; returned engine hits are mapped to `RagHit[]` and fed into `ContextAssembler`. Unavailable-store `[]` path propagates through `ragHits = []` with no throw. Asserted by `tests/unit/agentRunner.test.ts` "calls ragEngine.query(userMessage, {signal}) exactly once before ContextAssembler" (`calls.length === 1`, `text === 'ask thing'`, signal is an `AbortSignal`, system message contains `note.md#L2-4`) + "ragEngine unavailable-store path resolves to empty hits without throwing" + "ragEngine.query rejection is caught, logged, and does not abort the turn".
- AC7: PASS — `rag.query.tag-filter {requested, kept, dropped}` emitted at `debug` (`ragEngine.ts:105-109`) — counts only, never tag strings. `agent.turn.rag.ms {thread, ms}` and `agent.turn.rag.hits {thread, hits}` emitted at `debug` (`agentRunner.ts:229-236`). `tool.invoke.*` events inherit from `ToolRegistry.invoke` unchanged.
- AC8: PASS — Vitest suite enumerated: `TagMatcher` normalisation + `matches` + `compileTagPredicate` (16 tests); `RAGEngine` tag-filter behaviour (5 new tests: filter-before-cosine, `tags:[]` byte-identity, frontmatter+inline union, case-insensitive + `#`-strip, unfiltered-byte-identity); `search_vault` tool (12 tests: spec shape, validator rejection matrix, accepts tags:[], happy, empty-hits, signal threading, pre-aborted, exception, tags-undefined); `AgentRunner` pre-prompt `ragEngine.query` invocation + unavailable-store empty + failure-recovery (3 tests). Total 36 new tests.

## Scope coverage

- In scope "Extend `RAGEngine.query` signature with `tags?`": PASS — `src/rag/ragEngine.ts:30-34` adds `tags?: readonly string[]` to `QueryOpts`; `undefined` / `[]` strict identity to F31 path.
- In scope "`TagMatcher.matches` pure predicate at `src/rag/TagMatcher.ts`": PASS — file at `src/rag/tagMatcher.ts` (camelCase consistent with existing `excludeMatcher.ts`, `vectorStore.ts`).
- In scope "Tag-filter injection point in F31 scan path — after exclude, before cosine": PASS — `ragEngine.ts:96-109`.
- In scope "`search_vault` built-in `ToolSpec`": PASS — factory shipped; `Plugin.onload` registration parked.
- In scope "`AgentRunner` pre-prompt grounding `RAGEngine.query`": PASS — `agentRunner.ts:212-226`.
- In scope "Tag normalisation (case-insensitive, leading `#` stripped, literal nested paths)": PASS — `tagMatcher.ts:7-9` (single-tag) + `:11-22` (dedupe).
- In scope "`search_vault` result payload strictly `{hits: RAGHit[]}`": PASS — `searchVault.ts:75-80` returns `{hits}` verbatim from engine; no `text`/`chunkId`/`heading_path` added.
- In scope "Structured log events": PASS — at `debug` level (counts only) per deviation.
- In scope "Vitest coverage": PASS.

## Out-of-scope audit

- Out of scope "full cosine / top-K / merge pipeline": CLEAN — only tag-filter line added to the F31 scan path.
- Out of scope "glob-pattern exclude-list pre-scan": CLEAN — F32 exclude runs first; tag-filter is the second pass.
- Out of scope "graph / tag-shared score boost": CLEAN — no scoring changes.
- Out of scope "skill `allowedTools` gating of `search_vault`": CLEAN — `ToolRegistry.listFor(thread)` pass-through unchanged.
- Out of scope "tool-confirmation UX": CLEAN — `requiresConfirmation: false`; no confirm-flow touches.
- Out of scope "hierarchical tag prefix matching": CLEAN — literal equality after normalisation.

## QA aggregate
Verdict: PASS — typecheck / lint / 584-tests / build all green.

## Verdict: PASS (AC4 Plugin.onload `ToolRegistry.register(search_vault)` wiring parked alongside main.ts runtime integration slice; Zod replaced by hand-rolled validator to match existing project convention)
