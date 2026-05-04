# F15 — Inbox batch ingest path

## Purpose

Drain `wiki-inbox.md` sequentially under a single `delegate_wiki_ingest({kind:'inbox'})` call, invoking the single-source ingest path per item and updating the inbox file with success ticks or inline error annotations. Covers [context.md `Inbox`](../../context.md#inbox) FR-10 and the `inbox` discriminator of [FR-17](../../context.md#ingest-trigger--confirmation).

## Scope

- In:
  - `kind:'inbox'` input handled by the orchestrator (FR-17).
  - Sequential drain (concurrency 1) over open inbox items (FR-10).
  - Per-item invoke of single-source ingest, reusing F11 subgraph.
  - Per-item terminal — DONE → `tick(ref)`; ERROR → `annotateError(ref, code, msg)`; CANCELLED mid-batch → in-flight item completes per F11 cancel semantics, remaining items not started.
  - Per-item duplicate-detect interrupt surfaces in the F06 widget like single-source ingest.
- Out: parallel inbox drain; partial-line cleanup.

## Acceptance criteria

1. Inbox kind drains items sequentially with concurrency 1 (FR-10).
2. Per-item DONE ticks the line in place (FR-09).
3. Per-item ERROR annotates the line with `error: <code>: <msg>` and leaves `- [ ]` unticked (FR-09).
4. Per-item duplicate-detect interrupt surfaces through the F06 view-model identically to single-source ingest (FR-40).
5. Cancel mid-batch: in-flight item completes per F11 semantics; remaining items not started (FR-42, FR-43).
6. End-to-end test: a 3-item inbox with one duplicate, one fetch failure, and one happy path produces the expected ticks + annotations.

## Dependencies

- F12 (tool wrapper).
- F14 (parser + tick/annotate primitives).
- Anchors: [context.md `Inbox`](../../context.md#inbox), [context.md `Ingest Trigger & Confirmation`](../../context.md#ingest-trigger--confirmation).

## Implementation notes

- Orchestrator at `src/agent/wiki/ingest/orchestrator.ts` per [project-structure.md](../../../../standards/project-structure.md); per-item ingest reuses the F11 subgraph driver, so the single-in-flight rule per [architecture.md §1](../../../../architecture/architecture.md#1-architectural-principles) holds across the batch.
- Sequential drain via `src/util/fifoQueue.ts` per [project-structure.md](../../../../standards/project-structure.md) (mirrors `AgentRunner`'s queue idiom).
- AbortSignal threading per [architecture.md §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) and [code-style.md `Async & Concurrency`](../../../../standards/code-style.md).

## Open questions

- None.
