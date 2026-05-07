# Compliance iteration 1 — F11 canvas-extractor

## Acceptance criteria
- AC1: PASS — `tests/unit/canvas/extract.test.ts` "returns one ExtractorOutput keyed by sourceRef".
- AC2: PASS — "retries once with parser-error injected and succeeds".
- AC3: PASS — "two consecutive parse failures → extract_invalid; not in outputs".
- AC4: PASS — "serializes calls via semaphore (concurrency = 1)" with `acquireSpy` toHaveBeenCalledTimes(3).
- AC5: PASS — "truncates body exceeding inputCharBudget and logs at debug".
- AC6: PASS — "aborts in-flight extractor; outputs reflects only completed".
- AC7: PASS — "entities > 100 trips Zod cap; retry path engaged".

## Scope coverage
- In scope "`runExtractors(...)`": PASS — `src/agent/canvas/extract.ts:65-101`.
- In scope per-source sub-agent + tool_choice → `report_extraction`: PASS — `extract.ts:14-32` and constrained tool list.
- In scope schemas in `schemas.ts`: PASS — `EntityFragment`/`EdgeFragment`/`ExtractorOutput` added.
- In scope retry path: PASS — `extract.ts:142-156`.
- In scope semaphore from wiki: PASS — imports `@/agent/wiki/ingest/semaphore` 1:1.
- In scope body truncation: PASS — `truncateBody` at `extract.ts:241-244`.

## Out-of-scope audit
- Out of scope "Cross-source canonical-id resolution": CLEAN — F12 owns.
- Out of scope "Insights computation": CLEAN.
- Out of scope "Non-text source body normalization": CLEAN.

## QA aggregate
Verdict: PASS — typecheck/lint/tests/build all PASS.

## Integration notes
F11 has no wiring bullet. Module imported by F12/F16. Not yet referenced from `src/main.ts`. Confirmed intentional.

## Verdict: PASS
