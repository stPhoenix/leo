# Impl iteration 1 — F17 wiki-lint-checkers

## Summary
Implemented per-concern checkers and the proposing aggregator. Pure concerns (`orphan-page`, `orphan-raw`) read directly from F16's scan output. LLM concerns (`contradiction`, `stale`, `missing-page`, `missing-xref`, `research-gap`, `schema-drift`) run through an `LlmJsonInvoker` with token caps + Zod retry-once-then-error. Concurrency capped via the F09 semaphore + `runBatched`. Aggregator ranks findings by severity, separates schema patches into a dedicated `schemaPatch` field never inlined as a page edit. Research-gap findings are stamped to enforce `severity:'info', patch:null`.

## Files touched
- `src/agent/wiki/lint/schemas.ts` — `LintSeverity`, `LintConcern`, `LintFindingSchema`, `LintFindingsArraySchema`, `LintSchemaPatchSchema`.
- `src/agent/wiki/lint/checkers.ts` — `runCheckers(scan, concerns, deps, signal)` (pure + LLM dispatch), per-concern prompts, `runProposing(findings, scan, deps, signal)` returning ranked findings + `schemaPatch | null`.

## Tests added or updated
- `tests/unit/wikiLintCheckers.test.ts` — orphan-page/orphan-raw produce findings from scan (AC1); contradiction parses valid LintFinding[] (AC1); research-gap invariants stamped even when LLM violates them (AC2); retry-once-then-error → check_invalid (AC4); pre-aborted signal aborts gracefully (no LLM call); proposing severity ranking error→warn→info (AC3); schemaPatch separated + inline patch stripped (AC3).

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
- Pure concerns (`orphan-page`, `orphan-raw`) bypass the LLM entirely and surface findings deterministically from F16's scan output. Spec says "checker subagents per concern"; for these two, no LLM is needed because the answer is fully determined by the adjacency + raw/source map. This is faster + cheaper + more reliable. The LLM concerns still go through the subagent retry path.
- LLM-based concerns ship with v1 prompts. They are intentionally minimal — production lint quality comes from the model + prompt-engineering iterations beyond this slice. The Zod schema enforces structural validity; the prompt content can be tuned later without touching the public API.
- `missing-page` (entities mentioned in ≥3 pages without a page) is in the LLM concern bucket; a pure detector would require entity extraction beyond regex. The LLM is the right tool.

## Assumptions
- `proposingResult.findings` includes schema-drift findings with their `patch` field zeroed; the consolidated patch is in `schemaPatch`. F19's confirm UI uses both.
- Concurrency default is 1 (one concern at a time), bounded above by `WIKI_RUN_DEFAULTS.extractorConcurrencyMax = 2`. Higher caps risk overwhelming small-context models.

## Open questions
None.
