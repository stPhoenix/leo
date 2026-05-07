# Impl iteration 1 — F11 canvas-extractor

## Summary
Added `src/agent/canvas/extract.ts` exporting `runExtractors({items, schema, signal, traceConfig?}, deps) → {outputs, perSourceErrors}`. Per-source extractor sub-agent: streams `report_extraction` tool call constrained to `ExtractorOutput` Zod shape (entities ≤ 100, edges ≤ 200). Single retry on parse failure with parser issues injected. Concurrency bounded by shared `createSemaphore({maxConcurrency: CANVAS_BUDGETS.extractorConcurrency})` (default 1). Source body truncated to `extractorInputCap * 4` chars (≈ token budget); truncation logged at debug. `EntityFragment`/`EdgeFragment`/`ExtractorOutput` Zod schemas added to `src/agent/canvas/schemas.ts`. Extractor system prompt in `src/agent/canvas/extractPrompt.ts`.

## Files touched
- `src/agent/canvas/extract.ts` — extractor runner
- `src/agent/canvas/extractPrompt.ts` — system prompt builder
- `src/agent/canvas/schemas.ts` — added `EntityFragment`, `EdgeFragment`, `ExtractorOutput` schemas
- `tests/unit/canvas/extract.test.ts` — 7 unit tests

## Tests added or updated
- `tests/unit/canvas/extract.test.ts` covers AC1 (single source happy path), AC2 (single retry succeeds), AC3 (two failures → `extract_invalid`, not in outputs), AC4 (semaphore serializes calls; spy on `acquire`), AC5 (truncation + debug log), AC6 (abort), AC7 (entities > 100 trips Zod cap, retry path engaged).

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
- Token budget converted to char budget via `extractorInputCap * 4` heuristic. The project's `tokenEstimator.ts` uses chars/4 for OpenAI-style tokens; using char-budget directly avoids loading the estimator into the extractor hot path.
- The `report_extraction` tool's JSONSchema is permissive (`entities: array`, `edges: array`) — Zod is the strict gate post-call. Strict per-property JSONSchema would duplicate the Zod schema and risk drift.

## Assumptions
- Extractor concurrency default = 1 per `CANVAS_BUDGETS.extractorConcurrency`. Tests inject a custom semaphore via `semaphoreOverride` to verify serialization.
- Stream-event shape mirrors F08 refine (provider-normalized OpenAI/Anthropic events).
- `withDefaults` injects `schemaVersion: 1` and `sourceRef: <ref>` if the LLM omits them — small ergonomic guard for weak models.

## Open questions
- Bench at Phase 6 whether `extractorConcurrency = 2` halves wall-clock without VRAM regression (per feature.md open question). Not flipped in v1.
