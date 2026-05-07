# Impl iteration 1 — F12 canvas-reducer

## Summary
Added `src/agent/canvas/reduce.ts` exporting `reduceEntityGraph({outputs, signal, traceConfig?}, deps) → {graph, insights}`. Pure pre-resolution pass derives canonical ids: `wikilink:<target>` (square-bracketed names or `.md`-suffixed), `url:<lower>` (http(s)), or `<type>:<slug>` (normalized name). Aggregates entities by canonical id, merging `sources` (sorted unique, max 20) and `fields`. Detects ambiguous overlaps (same normalized name, different canonical ids) and invokes optional `resolve_aliases` LLM step (skipped when no overlap). Edges deduped by `(from, to, type)` triple → stable `id = "${from}|${to}|${type}"`. Insights: hubs top-5 by degree (alpha tie-break), components count + sorted sizes, orphans capped 50, perTypeCount. Throws `ReducerInvalidError` (code: `reduce_invalid`) on Zod failure or alias-resolver double-fail.

## Files touched
- `src/agent/canvas/reduce.ts` — reducer + insights computation
- `tests/unit/canvas/reduce.test.ts` — 9 unit tests

## Tests added or updated
- `tests/unit/canvas/reduce.test.ts` covers AC1 (wikilink dedupe + sources merge), AC2 (normalized-name dedupe), AC3 (LLM-alias step on overlap), AC4 (hubs sort), AC5 (components count + sizes), AC6 (alias-resolver 2 failures → `reduce_invalid`), AC7 (empty input fast path); plus edge dedupe + no-LLM-on-no-overlap.

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
- "One retry on Zod-parse failure with parser-error injected; second failure throws `reduce_invalid`" applies to the alias-resolver step. Pre-resolution graph + insights validation throws on first Zod failure (these are constructed by pure code; a Zod failure indicates a programmer error in this module, not LLM output, so a retry would just re-throw). The second-failure path is exercised by the alias-resolver tests.

## Assumptions
- A name with `[[...]]` brackets or `.md` suffix is a wikilink. Pure heuristic; matches refine prompt guidance.
- Alias-resolver is optional: when `deps.provider` is undefined, ambiguous overlaps fall through with separate canonical ids — acceptable for v1 unit tests and offline runs.
- `Edge.id` is deterministic across re-runs per feature.md open-question resolution.

## Open questions
- Bench at Phase 6 whether to skip alias-resolver entirely below an entity-count threshold (per feature.md/open-question-§15.4). Always-conditional in v1.
