# Compliance iteration 1 — F10 wiki-ingest-writer

## Acceptance criteria
- AC1: PASS — `writer.ts:writeIngest` runs phases in fixed order: creates (sorted by slug), edits (sorted by slug), sourceSummaries (sorted by rawPath), index regenerate, log append. Test "writes creates before edits before sources before index before log" verifies write log indices.
- AC2: PASS — Each phase wraps `await deps.vault.write(...)` in try/catch; failures push into `errors[]` and execution continues. Test "mid-phase failure leaves prior writes; run continues; error captured" forces a failure on `pages/beta.md` and asserts alpha+gamma still wrote, error captured, index+log still attempted.
- AC3: PASS — `regenerateIndex` reads current `wiki/pages/` listing, parses `tags` frontmatter, groups + sorts categories. Test "regenerates index from current pages/ frontmatter (sorted by slug, grouped by tag)".
- AC4: PASS — `writeIngest` reads existing `WIKI_LOG_PATH` and appends rather than overwriting. Test "preserves existing log content on append" asserts both old and new run ids present.
- AC5: PASS — `renderSource` emits frontmatter with `source_url`, `fetched_at`, `sha256`, and `raw_path`. Test "cites raw_path and sha256 in source-summary frontmatter (FR-04)" asserts all three keys.
- AC6: PASS — Tests cover happy path, partial write failure, deterministic ordering with sorted keys.

## Scope coverage
- In scope "Apply page creates first, then page edits, then sources/ summary writes, then regenerate index.md, then append log.md (FR-32)": PASS — exact order verified.
- In scope "Per-file atomic writes via VaultAdapter": PASS — every write is a single `vault.write` call.
- In scope "Mid-phase failure leaves prior writes; run continues then transitions to terminal error (FR-46)": PASS — `errors[]` captured; run does not throw; F11 will inspect `errors.length` and decide terminal phase.
- In scope "sources/ summary frontmatter cites raw_path": PASS.

## Out-of-scope audit
- Out of scope "extractor / reducer logic": CLEAN — F10 only consumes `ReducerOutput` shape; no extractor/reducer code.
- Out of scope "FSM driver (F11)": CLEAN — `writeIngest` is a pure async function with no LangGraph references.
- Out of scope "lint writer reuse (F19)": Forward-compatible — `writeIngest` is invoked by both ingest (F11) and lint writing (F19) per dependency graph; no lint-specific code added here.

## QA aggregate
QA verdict: PASS (typecheck/lint/2208 tests/build all PASS).

## Integration notes
- F10 has no consumer at the entry point yet; F11 (ingest subgraph WRITING phase) and F19 (lint WRITING) will invoke `writeIngest`. The `### In scope` bullets are domain-logic file ordering, not wiring (no register/mount/onload regex matches). §5.3.1 emits a warning, not a gap. Workspace audit (§5.4) re-verifies after F11 ships.
- No stub bodies (§5.3.2): all helpers (`renderPage`, `renderSource`, `regenerateIndex`, `renderLogLine`, frontmatter parser) have real bodies.

## Verdict: PASS
