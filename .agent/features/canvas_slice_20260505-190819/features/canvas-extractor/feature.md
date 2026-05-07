# F11 · canvas-extractor — Extractor sub-agent + concurrency

## Purpose

For each successfully-fetched source, run an extractor sub-agent with the inferred `entityTypes + relationTypes` from refine and emit a Zod-validated `ExtractorOutput` (entities + edges with tempIds). Bounded by `extractorConcurrency = 1` (max 2) via the shared `semaphore.ts` from wiki ingest. Source body is truncated to `extractorInputCap = 8000` tokens. Parse failures retry once with parser-error injection; second failure marks the source `extract_invalid` and the run continues (partial-success).

Covers [FR-CANVAS-15](../../context.md#functional-requirements), [FR-CANVAS-16](../../context.md#functional-requirements), [NFR-CANVAS-07](../../context.md#non-functional-requirements), [NFR-CANVAS-08](../../context.md#non-functional-requirements).

## Scope

**In scope**

- `src/agent/canvas/extract.ts` exporting `runExtractors({ items, schema, deps, signal }) → Promise<{ outputs: ReadonlyMap<string, ExtractorOutput>; perSourceErrors: { ref: string; code: string; message: string }[] }>`.
- Per-source extractor sub-agent build that uses `entityTypes + relationTypes` to constrain `tool_choice` to a single `report_extraction` call producing the `ExtractorOutput` shape.
- `EntityFragment` / `EdgeFragment` / `ExtractorOutput` Zod schemas per SRS §8.1, with `entities.max(100)` and `edges.max(200)` caps.
- One Zod-parse retry path: on first parse-fail, append a tool-message containing the Zod issue array, re-invoke, accept second response or mark source `extract_invalid`.
- Concurrency bound via shared `src/agent/wiki/ingest/semaphore.ts`.
- Body truncation to `extractorInputCap` tokens (token estimator already present in `src/agent/tokenEstimator.ts`).

**Out of scope**

- Cross-source canonical-id resolution — F12.
- Insights computation — F12.
- Non-text source body normalization — out of v1 (text only).

## Acceptance criteria

1. Single source with valid LLM response → returns one `ExtractorOutput` keyed by `sourceRef` — traces to FR-CANVAS-15, FR-CANVAS-16.
2. LLM emits malformed JSON → second retry with parser-error injection succeeds; resulting output parses cleanly — traces to NFR-CANVAS-07.
3. Two consecutive parse failures → source's `errorCode === 'extract_invalid'`; not present in `outputs` map — traces to FR-CANVAS-15, NFR-CANVAS-07.
4. Concurrent fan-out with `extractorConcurrency = 1` serializes calls (verified via spy on semaphore acquire) — traces to NFR-CANVAS-08.
5. Source body exceeding `extractorInputCap` is truncated; truncation logged at `debug` — traces to NFR-CANVAS-10 (budget surface).
6. Abort signal cancels in-flight extractor; `outputs` returned reflects only completed sources.
7. `entities` exceeding cap of 100 (Zod) → parse fails; retry path engaged.

## Dependencies

- [../canvas-budgets-runid-slug/feature.md](../canvas-budgets-runid-slug/feature.md) — `extractorInputCap`, `extractorOutputCap`, `extractorConcurrency`.
- [../canvas-refine/feature.md](../canvas-refine/feature.md) — supplies `entityTypes + relationTypes`.
- [../canvas-source-fetcher/feature.md](../canvas-source-fetcher/feature.md) — produces fetched items.
- External reuse: `src/agent/wiki/ingest/semaphore.ts`, `src/agent/wiki/ingest/llmAdapter.ts` (`createLlmJsonInvoker` retry chain pattern).
- Forward consumers: [../canvas-reducer/feature.md](../canvas-reducer/feature.md), [../canvas-subgraph/feature.md](../canvas-subgraph/feature.md).
- Requirements traced: [../../context.md#functional-requirements](../../context.md#functional-requirements) FR-CANVAS-15, FR-CANVAS-16; [../../context.md#non-functional-requirements](../../context.md#non-functional-requirements) NFR-CANVAS-07, NFR-CANVAS-08.

## Implementation notes

- [../../../../architecture/architecture.md#4-key-contracts](../../../../architecture/architecture.md#4-key-contracts) — `Provider`, `tool_choice` plumbing, `ProviderChatRequest`.
- [../../../../architecture/architecture.md#5-data-flows](../../../../architecture/architecture.md#5-data-flows) — wiki ingest extract → reduce dataflow mirrored.
- [../../../../standards/code-style.md#langgraph--agent-layer](../../../../standards/code-style.md#langgraph--agent-layer) — Zod-validated tool returns; `AbortSignal` propagation.
- [../../../../standards/code-style.md#async--concurrency](../../../../standards/code-style.md#async--concurrency) — semaphore-bounded fan-out; no ad-hoc `Promise.all`.
- [../../../../standards/best-practices.md#core-principles](../../../../standards/best-practices.md#core-principles) — Framework First: reuse wiki `llmAdapter` retry chain.

## Open questions

- Should we cap to `extractorConcurrency = 2` by default to halve wall-clock while still respecting Qwen3 30B local-VRAM constraints? Bench at Phase 6; ship with `1` default and flip via `budgets.ts` if measurements support.
- Should extractor system prompt be a snapshot (lint-tested for byte stability) like refine? Yes — colocate `extractPrompt.ts` alongside `extract.ts`.
