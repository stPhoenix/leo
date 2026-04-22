# Impl iteration 1 — F34 graph-cache-symmetric

## Summary

Added `GraphCache` adapter at `src/graph/GraphCache.ts`: symmetric in-memory adjacency `Map<string, Set<string>>` built from `app.metadataCache.resolvedLinks` (forward-plus-back merge) and kept fresh via a single `metadataCache.on('resolved')` listener registered through `Plugin.registerEvent`. A shadow `forward: Map<string, Set<string>>` records the last-seen outgoing edges per source so each `resolved` tick computes an `O(Δ)` diff — adds new targets, removes stale ones, drops sources that disappear from the latest `resolvedLinks` snapshot — and the handler emits `graph.resolved.tick {pathsTouched, edgesAdded, edgesRemoved}`. Read surface is pure: `neighbors(path)` returns a shared frozen empty set singleton on miss (same reference across calls, zero allocation on the hot path), `has(path)` returns `false` for orphans because empty sets are deleted from the adjacency map, `size()` returns node-with-neighbors count, `snapshot()` returns a deep read-only copy. `shutdown()` clears both maps, calls `metadataCache.offref(ref)` if provided, and leaves the cache in a state where the next `init()` rebuilds from scratch.

## Files touched

- `src/graph/GraphCache.ts` — new adapter. Exports `GraphCache` class, `MetadataCacheLike` / `PluginLike` / `ResolvedLinks` / `EventRef` types for test doubles and runtime bindings. `EMPTY_SET` shared frozen singleton.

## Tests added or updated

- `tests/unit/graphCache.test.ts` — 16 cases covering AC1–AC8:
  - init symmetrizes forward-only `resolvedLinks` (AC1).
  - init registers exactly one listener via `Plugin.registerEvent` (AC3).
  - `init()` is idempotent (byte-identical snapshot on re-run) (AC5).
  - `neighbors(miss)` returns the shared frozen empty set singleton (same reference, frozen) (AC2).
  - `has()` false for orphans / unknown paths (AC2).
  - `size()` counts nodes with at least one neighbor (AC2).
  - `snapshot()` deep read-only view — mutating caller's copy does not affect cache (AC2).
  - `resolved` tick adds new edges and removes stale ones symmetrically (AC3, AC4).
  - `resolved` replay on unchanged payload is a no-op — `edgesAdded=0, edgesRemoved=0` in `graph.resolved.tick` (AC5).
  - rename path: old source disappears, reciprocal edges drop, new source wired both-ways (AC4).
  - delete path: orphaned node removed from the `Map` (AC4).
  - create path: new source inserts symmetric edges (AC4).
  - modify path: target-set changes propagate both directions (AC4).
  - `shutdown()` clears the map, calls `offref`, leaves `size()===0` (AC7).
  - re-init after shutdown rebuilds from current `resolvedLinks` with no stale state (AC7).
  - `graph.build.complete {nodeCount, edgeCount}` log event fires on init (AC6).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **`graph.resolved.tick` emitted at `debug` level, `graph.build.complete` + `graph.shutdown` at `info`.** Feature § "structured log events" does not pin a level; NFR-LOG-04 specifies counts only (no path payloads) which this implementation honors. Tick-level events during normal indexing could be noisy at `info`; the one-shot build + shutdown events stay at `info` for lifecycle visibility. Counts only — no `path` field at any level.
- **`shutdown()` uses `metadataCache.offref(ref)` when available.** Feature says "unsubscribes the `resolved` listener via the `Plugin.registerEvent` handle"; the real Obsidian API disposes via `offref` or via plugin-scoped auto-cleanup on `onunload`. Implementation prefers `offref` when the metadataCache exposes it (matches Obsidian's surface), falls back silently when absent so the `registerEvent` auto-dispose path still holds at plugin unload.
- **No separate `vault.on(create|modify|rename|delete)` subscriptions.** Per scope, the `resolved` event is the single source of truth for adjacency updates — implementation matches exactly.

## Assumptions

- Obsidian's `metadataCache.on('resolved')` fires globally after a change burst, so re-reading the full `resolvedLinks` snapshot per tick is the correct diff base. The shadow `forward` map makes the diff O(Δ) rather than O(total edges), addressing the feature Open question §2 proposal directly.
- Canvas / non-markdown targets that surface in `resolvedLinks` are stored verbatim as opaque path strings (feature Open question §1 proposal). Tag-index consumers (F35) treat non-indexed neighbors as boost-skippable; this adapter does not filter.
- Runtime wire-up (`new GraphCache({metadataCache: app.metadataCache, plugin: this, logger})` in `Plugin.onload`, `cache.init()` after workspace layout ready, `cache.shutdown()` in `Plugin.onunload`) is part of the main.ts integration slice — same pattern as F27 VaultIndexer, F29 VectorStore, F32 ExcludeListStore.

## Open questions

- Canvas / non-markdown target filtering (feature Open question §1) — current behavior stores verbatim; verifier to confirm this matches the v1 contract or push a filter into this adapter.
- Diff granularity (feature Open question §2) — current shadow-forward-map strategy gives O(Δ) updates; verifier to confirm acceptable at 10 k vault scale per NFR-PERF-02 or recommend full-rebuild.
- Tag-shared boost prerequisites (feature Open question §3) — confirmed in scope: this feature owns link edges only; tag→paths index stays with F28 chunk-tag payloads. No change needed.
