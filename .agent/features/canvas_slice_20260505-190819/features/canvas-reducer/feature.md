# F12 · canvas-reducer — Reducer + insights computation

## Purpose

Single-pass reduction over per-source `ExtractorOutput[]`: dedupe entities by canonical id resolution (a) wikilink-target match, (b) URL match, (c) normalized name match, (d) reducer-LLM alias resolution for ambiguous overlaps. Produces a Zod-validated `EntityGraph` with stable `id`s and the `Insights` block (`hubs` top-5, `components` count + sizes, `orphans` capped 50, `perTypeCount`).

Covers [FR-CANVAS-17](../../context.md#functional-requirements), [FR-CANVAS-18](../../context.md#functional-requirements), [FR-CANVAS-19](../../context.md#functional-requirements), [FR-CANVAS-44](../../context.md#functional-requirements) (insights computation), [NFR-CANVAS-07](../../context.md#non-functional-requirements).

## Scope

**In scope**

- `src/agent/canvas/reduce.ts` exporting `reduceEntityGraph({ outputs, deps, signal }) → Promise<{ graph: EntityGraph; insights: Insights }>`.
- Pure pre-resolution pass: build canonical-id candidates (wikilink → URL → normalized-name) without LLM.
- LLM-alias step: invoked only for ambiguous overlaps (multiple candidates pointing at the same entity name with conflicting types). Bounded budget (`reducerInputCap = 6000`, `reducerOutputCap = 2500`).
- `Entity` / `Edge` / `EntityGraph` Zod schemas per SRS §8.2 (with caps `entities.max(500)`, `edges.max(2000)`).
- `Insights` Zod schema per SRS §8.3 (`hubs.max(5)`, `orphans.max(50)`).
- Canonical-id format: `<entityType>:<slug>` for normalized-name; `wikilink:<targetPath>` and `url:<href>` for the typed cases.
- One retry on Zod-parse failure with parser-error injected; second failure throws `reduce_invalid`.

**Out of scope**

- Diff-against-sidecar — F14.
- Insights rendering — F18 (terminal block) and F19/F20/F21 (tool result).

## Acceptance criteria

1. Two extractor outputs both naming "Alice" with same wikilink → reduced to one `Entity` with `sources: ['file-a.md', 'file-b.md']` — traces to FR-CANVAS-17.
2. Two extractor outputs naming "Alice" with no wikilink, normalized names match → still reduce to one entity — traces to FR-CANVAS-17.
3. Ambiguous overlap (same name, different types) → LLM-alias step invoked, producing alias resolution; result passes Zod parse — traces to FR-CANVAS-17, NFR-CANVAS-07.
4. `Insights.hubs` lists top-5 entities by edge degree, ties broken alphabetically — traces to FR-CANVAS-18, FR-CANVAS-44.
5. `components` reports total component count + sorted size list — traces to FR-CANVAS-18.
6. Reducer LLM parse failure twice → throws `reduce_invalid` (caller transitions run to ERROR per FR-CANVAS-19) — traces to FR-CANVAS-19.
7. Empty input → empty graph, empty insights (no LLM call) — fast path covered.

## Dependencies

- [../canvas-extractor/feature.md](../canvas-extractor/feature.md) — produces input `ExtractorOutput[]`.
- [../canvas-budgets-runid-slug/feature.md](../canvas-budgets-runid-slug/feature.md) — reducer budgets.
- External reuse: `src/agent/wiki/ingest/llmAdapter.ts` (retry chain).
- Forward consumers: [../canvas-diff/feature.md](../canvas-diff/feature.md), [../canvas-layouts/feature.md](../canvas-layouts/feature.md), [../canvas-subgraph/feature.md](../canvas-subgraph/feature.md), [../canvas-widget-live/feature.md](../canvas-widget-live/feature.md) (insights peek), [../canvas-widget-terminal/feature.md](../canvas-widget-terminal/feature.md), [../delegate-canvas-create/feature.md](../delegate-canvas-create/feature.md) (tool result).
- Requirements traced: [../../context.md#functional-requirements](../../context.md#functional-requirements) FR-CANVAS-17..19, FR-CANVAS-44; [../../context.md#non-functional-requirements](../../context.md#non-functional-requirements) NFR-CANVAS-07.

## Implementation notes

- [../../../../architecture/architecture.md#3-modules](../../../../architecture/architecture.md#3-modules) — pure-domain module placement.
- [../../../../architecture/architecture.md#5-data-flows](../../../../architecture/architecture.md#5-data-flows) — wiki ingest reducer dataflow mirrored.
- [../../../../standards/code-style.md#langgraph--agent-layer](../../../../standards/code-style.md#langgraph--agent-layer) — typed return shape.
- [../../../../standards/code-style.md#zod--tool-schemas](../../../../standards/code-style.md#zod--tool-schemas) — `EntityGraph` Zod is the single source of truth.
- [../../../../standards/best-practices.md#core-principles](../../../../standards/best-practices.md#core-principles) — KISS: skip LLM-alias step when there are no ambiguous overlaps (matches SRS §15.4 open question; default-fast-path baked in).

## Open questions

- For graphs under N entities, should the LLM-alias step be unconditionally skipped? Default to skip when no ambiguous overlaps detected at pre-resolution; the SRS-15.4 question is about always-skip below N entities — defer the always-skip flag until benchmarked.
- Edge dedupe: same `(from, to, type)` triple appearing in multiple sources — dedupe, but `Edge.id` should remain stable across re-runs. Use `<from>|<to>|<type>` as deterministic id.
