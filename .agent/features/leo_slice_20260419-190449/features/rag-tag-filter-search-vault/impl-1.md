# Impl iteration 1 — F33 rag-tag-filter-search-vault

## Summary

Added pure `TagMatcher` (`src/rag/tagMatcher.ts`) with `normalizeTag / normalizeTags / matches / compileTagPredicate` supporting `#`-strip, lowercase, trim, dedupe, and frontmatter ∪ inline union. Extended `RAGEngine.query(opts)` with optional `tags?: readonly string[]` that filters rows AFTER the F32 exclude predicate and BEFORE `Scorer.cosine`, so tag-rejected rows never occupy a top-K slot; empty `tags` (`undefined` or `[]`) short-circuits to the F31 no-filter path byte-identically. Registered the `search_vault` built-in `ToolSpec` at `src/tools/builtin/searchVault.ts` with a hand-rolled validator matching the F16 pattern (`query: string(min 1), tags?: string[]`), `requiresConfirmation: false`, and a thrown-exception-only error path — empty hits stay `{ok:true,data:{hits:[]}}`. Wired `AgentRunner` pre-prompt grounding: new optional `ragEngine?: RagEngineLike` option that replaces the `RagHitsProvider` stub for the turn-start call, emits `agent.turn.rag.ms` + `agent.turn.rag.hits`, and threads `slot.abort.signal` into the engine; `RagHit` shape relaxed (`content?`, `line_start?`, `line_end?`) so the new `{path, line_start, line_end, score}` hits render as `path#L<start>-<end>` without forcing prose re-reads in-band.

## Files touched

- `src/rag/tagMatcher.ts` — new pure predicate module: `normalizeTag`, `normalizeTags`, `matches`, `compileTagPredicate`.
- `src/rag/ragEngine.ts` — added `tags?` to `QueryOpts`; tag-filter pass after exclude and before `selectTopK`; `rag.query.tag-filter{requested, kept, dropped}` debug event.
- `src/tools/builtin/searchVault.ts` — new `ToolSpec` factory `createSearchVaultTool(engine)`; hand-rolled validator (no zod) per project convention; no-filter semantics when `tags` omitted.
- `src/agent/types.ts` — `RagHit.content` / `line_start` / `line_end` made optional to accept the new hit shape.
- `src/agent/agentRunner.ts` — new `RagEngineLike` / `RagEngineHit` interfaces + `ragEngine?` option; pre-prompt call uses `ragEngine` when set; `agent.turn.rag.ms` + `agent.turn.rag.hits` debug events.
- `src/agent/contextAssembler.ts` — render RAG hits as `path#L<start>-<end>` locator when line fields present; skip the `: <content>` tail when content is absent.
- `src/agent/truncator.ts` — token estimate falls back to `h.path` when `content` is absent.

## Tests added or updated

- `tests/unit/tagMatcher.test.ts` — 16 cases: `normalizeTag` 5-way normalisation matrix; `normalizeTags` dedup + empty-drop; `matches` covers empty / single / multi / zero-intersection / case-insensitive / `#`-strip / frontmatter-only / inline-only / union / malformed-safe; `compileTagPredicate` always-true + equivalence cases (AC2, AC8).
- `tests/unit/ragEngine.test.ts` — 5 new cases: `tags` filter rejects rows before cosine (100 rows, 10 tagged → hit count = min(10, K)); `tags:[]` byte-identical to no-filter; union frontmatter+inline sources; case-insensitive + `#`-strip; preserves F31 top-K ordering on unfiltered runs (byte-identity) (AC1, AC3, AC8).
- `tests/unit/searchVault.test.ts` — 12 cases: spec shape + id/source/confirmation; validator rejects missing/empty/non-string query, non-array tags, non-string tag entries; accepts query-only + `tags:[]`; invoke happy path returns `{ok:true,data:{hits}}`; empty-hits ok; threads `ctx.signal`; pre-aborted signal → `{ok:false,error:'aborted'}` without engine call; catches engine exception (AC4, AC5, AC8).
- `tests/unit/agentRunner.test.ts` — 3 new cases: `ragEngine.query(userMessage.content, {signal})` invoked exactly once per turn before ContextAssembler; system message embeds `path#L<start>-<end>` locator from the hit; rejected engine → `agent.rag.failure` logged without aborting the turn (AC6).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **No Zod parse in the tool validator.** Feature prescribes `z.object({query: z.string().min(1), tags: z.array(z.string()).optional()})`. The project convention (see `readNoteTool.ts`) is hand-rolled `validate(raw)` predicates — no Zod runtime dependency exists in the codebase. The validator enforces the same contract (query non-empty string; tags, if present, must be an array of strings) and returns the same `{ok:false,error}` shape that `ToolRegistry.invoke` wraps into the OpenAI tool-result payload.
- **`agent.turn.rag.ms` + `agent.turn.rag.hits` emitted at `debug` level** (not `info`). NFR-LOG-01 forbids tag strings above `debug`; keeping the grounding-call telemetry at the same level keeps the log channel consistent and avoids duplicate noise with the existing `agent.turn.start/done/truncate` counters. Counts only — no tag strings — per NFR-LOG-01 / NFR-LOG-04.
- **`RagHit.content` relaxed to optional instead of removed.** F10's `ContextAssembler` renderer was written against `{path, score, content}` and the existing `contextAssembler.test.ts` / `truncator.test.ts` rely on that shape. Keeping `content?` optional allows the new hit-by-path+lines shape to flow through while preserving F10's tests; renderer falls back to `path#L<start>-<end>` when lines are present and skips the prose suffix when `content` is absent. ContextAssembler prose re-reads via VaultAdapter stay parked for the main.ts integration slice.
- **Pre-prompt RAG timeout deferred.** Open question §3 proposes a 1 s soft timeout. Not implemented — the `agent.rag.failure` catch already returns `[]` on any thrown error, and the skill contract marks `agent.turn.rag.timeout` as a punt candidate for F50. Logged as a follow-up in Open questions.

## Assumptions

- The `search_vault` tool registration at `Plugin.onload` is part of the main.ts runtime wire-up integration slice — same pattern followed for every previous feature (F16 `read_note`, F17 confirmation hook, F24 Enter/ExitPlanMode, F30 reindex command, F32 exclude list). The `createSearchVaultTool(engine)` factory is unit-tested against a fake engine; the registry wiring is one `register()` call in `main.ts`.
- `ContextAssembler` prose re-read via `VaultAdapter` is orthogonal to this slice's tag filter + tool adapter + pre-prompt wiring. The renderer already emits `path#L<start>-<end>` locators that the LLM can cite; inline prose enrichment is a separate enrichment pass that would live next to the pre-prompt RAG call.
- The existing 1000-row reference-sort parity test in `ragEngine.test.ts` is sufficient regression coverage for "tag-filter preserves top-K ordering on unfiltered runs"; adding a 100+ row fixture with mixed tags would duplicate coverage without exercising new paths.

## Open questions

- Pre-prompt RAG soft timeout (1 s → `[]` + `agent.turn.rag.timeout`) per feature Open questions §3 — punted to F50 perf-scale-10k-vault; confirm acceptability with verifier.
- Hierarchical tag prefix matching (`area` ⊇ `area/work`) — feature Open question §1 asks verifier to confirm literal-only is the v1 contract. Current implementation is literal string equality after normalisation; hierarchical semantics would add a trie prefix pass in `compileTagPredicate`.
- `search_vault` result payload is strictly `{path, line_start, line_end, score}` — feature Open question §2 asks whether to inline `VaultAdapter.read` slices. Current design keeps the tool cheap and lets downstream `ContextAssembler` own prose-loading.
