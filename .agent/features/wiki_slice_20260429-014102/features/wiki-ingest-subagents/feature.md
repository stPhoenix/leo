# F09 — Ingest planner + extractor + reducer subagents

## Purpose

The three LLM-bound nodes of the ingest subgraph — single-call planner, fan-out extractor (per raw entry), fan-out reducer (per affected page) — with explicit token caps, Zod retry-once-then-mark-error, and concurrency caps via an explicit semaphore module. Covers [context.md `Ingest Subgraph — Phases`](../../context.md#ingest-subgraph--phases) FR-29, FR-30, FR-31 and [context.md `Non-functional requirements`](../../context.md#non-functional-requirements) NFR-06, NFR-07, NFR-08.

## Scope

- In:
  - Planner: single LLM call producing `{ ingestId, perSource: [{ rawPath, candidatePages: string[] }] }`; Zod-validated (FR-29).
  - Extractor: fan out per raw entry under `extractorConcurrency` semaphore (default 1, max 2); input truncated to `extractorInputCap=8000`, output capped at `extractorOutputCap=1500`; Zod-validated `ExtractorOutput`; one retry with parser error appended; second failure marks source `error: extract_invalid` (FR-30, NFR-07).
  - Reducer: fan out per affected page under `reducerConcurrency` semaphore (default 1); inputs current page (or empty for create) + all `page_ops` + `SCHEMA.md`; bounded by `reducerInputCap=6000` / `reducerOutputCap=2000`; Zod-validated `ReducerOutput`; same retry behavior; second failure marks page `error: reduce_invalid` and leaves it untouched (FR-31, NFR-07).
  - Semaphore module — explicit, never `Promise.all` (NFR-08).
- Out: FSM driver (F11), writer (F10).

## Acceptance criteria

1. Planner output Zod-validated; non-conforming output marks the run errored (FR-29).
2. Extractor + reducer enforce token caps as defined in `budgets.ts` (NFR-10).
3. Extractor + reducer retry-once-then-mark-error semantics hold (FR-30, FR-31, NFR-07).
4. Concurrency caps enforced via the explicit semaphore module; no ad-hoc `Promise.all` (NFR-08).
5. End-to-end testable with a canned `AsyncIterable` LLM and fake `VaultAdapter` (NFR-06).
6. Each subagent threads the `AbortSignal` through `LLM.stream({ signal })`.

## Dependencies

- F04 (budgets, logging namespaces).
- F08 (raw entries to extract from).
- Anchors: [context.md `Ingest Subgraph — Phases`](../../context.md#ingest-subgraph--phases), [context.md `Non-functional requirements`](../../context.md#non-functional-requirements).

## Implementation notes

- Zod schemas `ExtractorOutput`, `ReducerOutput`, `PageOp` are described in the SRS — see [context.md `Functional requirements`](../../context.md#functional-requirements) §8.1, §8.2.
- Intra-tool fan-out (extractor / reducer concurrency) does not bypass the global single-in-flight `AgentRunner` queue in [architecture.md §1](../../../../architecture/architecture.md#1-architectural-principles); the parent agent turn is one in-flight unit and intra-tool concurrency is allowed.
- LangChain subpath imports only (`@langchain/core/messages`, `@langchain/core/tools`) per [code-style.md `LangGraph / Agent Layer`](../../../../standards/code-style.md).
- Token estimator for cap enforcement at `src/agent/tokenEstimator.ts` per [project-structure.md](../../../../standards/project-structure.md).
- Mock-LLM testability per [tech-stack.md `Testing`](../../../../standards/tech-stack.md).

## Open questions

- OQ-2 — merge planner into refine sub-agent on small models; measure on Qwen 30B in Phase 5 per [context.md `Open questions`](../../context.md#open-questions).
