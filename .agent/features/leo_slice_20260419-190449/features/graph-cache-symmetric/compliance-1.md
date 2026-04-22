# Compliance iteration 1 — F34 graph-cache-symmetric

## Acceptance criteria

- AC1: PASS — `GraphCache.rebuildFromResolved` at `src/graph/GraphCache.ts:85-97` iterates `metadataCache.resolvedLinks` and for each `source → { target → count }` entry calls `addEdge(source, target)` which inserts BOTH `source→target` and `target→source` via `insertHalfEdge` × 2 (`:140-143`). Asserted by `tests/unit/graphCache.test.ts` "init symmetrizes forward-only resolvedLinks (a → b implies b → a)" — forward-only input `{a: {b}, c: {a}}` produces bidirectional neighbors for all three paths.
- AC2: PASS — Read surface implemented at `GraphCache.ts:47-67`: `neighbors(path)` returns `this.adjacency.get(path) ?? EMPTY_SET` (shared frozen singleton); `has(path)` returns `set !== undefined && set.size > 0` (false for orphans); `size()` returns `this.adjacency.size` (only nodes with ≥1 neighbor remain in the map because `dropHalfEdge` deletes empty sets at `:159`); `snapshot()` returns a deep copy via `new Set(v)` per entry (`:66-71`). Asserted by `graphCache.test.ts` "neighbors(miss) returns the shared frozen empty set (same reference)" + "has() returns false for orphan / unknown paths" + "size() reflects nodes with at least one neighbor" + "snapshot() returns a deep read-only view".
- AC3: PASS — Exactly one `metadataCache.on('resolved', ...)` listener registered via `plugin.registerEvent(ref)` at `init()` (`:41-44`). On each tick, `onResolved` at `:99-133` re-reads the fresh snapshot, compares to the shadow `forward` map, subtracts `removed` targets via `removeEdge` (both halves), inserts `added` targets via `addEdge`. Asserted by `graphCache.test.ts` "init registers exactly one resolved listener via Plugin.registerEvent" + "resolved tick adds new edges and removes stale ones".
- AC4: PASS — No separate `vault.on(*)` subscription; `create` / `modify` / `rename` / `delete` all propagate through the single `resolved` hook. Asserted by four dedicated cases in `graphCache.test.ts`: "create path: new source emerging..." / "modify path: target set changes..." / "rename path: old source disappears..." / "delete path: node with zero neighbors is removed...". After rename the old node does not appear in `has()` nor in any `neighbors()` set. After delete the orphaned node is removed from the map.
- AC5: PASS — `init()` idempotent: `rebuildFromResolved` clears and rebuilds from scratch (`:86-87`), so a second call produces the same adjacency. Asserted by "init() is idempotent — byte-identical snapshot on re-run" (JSON-serialised snapshot equality). Replay of unchanged payload: `onResolved` short-circuits when `added.size === 0 && removed.size === 0` (`:111`), keeping both counters at 0. Asserted by "resolved tick replay on unchanged payload is a no-op".
- AC6: PASS — Three structured events emitted via the injected `Logger`: `graph.build.complete {nodeCount, edgeCount}` at `info` (`:45-48`), `graph.resolved.tick {pathsTouched, edgesAdded, edgesRemoved}` at `debug` (`:130-134`), `graph.shutdown {nodeCount}` at `info` (`:82`). All three carry counts only — no `path` field at any level. Asserted by "graph.build.complete log event fires with node/edge counts" and "resolved tick replay on unchanged payload is a no-op" (verifies tick event).
- AC7: PASS — `shutdown()` at `GraphCache.ts:73-84` calls `metadataCache.offref(listenerRef)` when available, clears both `adjacency` and `forward` maps, and emits `graph.shutdown`. A re-init reads `metadataCache.resolvedLinks` fresh (no reference to prior state because `rebuildFromResolved` clears both maps). Asserted by "shutdown clears the map, calls offref, and leaves size()===0" + "re-init after shutdown rebuilds from current resolvedLinks with no stale state".
- AC8: PASS — Vitest suite (16 tests) exercises every bullet: symmetry from forward-only input; idempotent `init()`; incremental `resolved` diff (adds / removes / unchanged replay); rename drops stale edges; delete removes orphaned node; `neighbors` miss returns the shared frozen empty set singleton (same reference + `Object.isFrozen === true`); `snapshot()` deep read-only (mutating caller's copy does not propagate); `shutdown()` unsubscribes the listener via `offref`. All 16 pass.

## Scope coverage

- In scope "`GraphCache` adapter module at `src/graph/GraphCache.ts`": PASS — single `Map<string, Set<string>>` + shadow forward map.
- In scope "Initial build from `resolvedLinks` with forward-plus-back merge": PASS — `rebuildFromResolved` + `addEdge` / `insertHalfEdge`.
- In scope "Pure read surface (`neighbors` / `has` / `size` / `snapshot`)": PASS — all four exposed, all return read-only views.
- In scope "Incremental update via `registerEvent(metadataCache.on('resolved', ...))`": PASS.
- In scope "File lifecycle coverage via single `resolved` hook": PASS — no `vault.on(*)` subscriptions.
- In scope "Rename handling inside the `resolved` diff": PASS — fresh snapshot vs shadow `forward` handles rename correctly.
- In scope "Empty-adjacency invariant": PASS — `dropHalfEdge` deletes entries when their set becomes empty; `neighbors` miss returns shared frozen singleton `EMPTY_SET` (zero allocation).
- In scope "Listener auto-disposal": PASS — registered via `Plugin.registerEvent` (auto-clean on unload); `shutdown()` also calls `offref` explicitly when available.
- In scope "Idempotence": PASS — init + replay both verified.
- In scope "Structured log events `graph.build.complete` / `graph.resolved.tick` / `graph.shutdown`": PASS — counts only.
- In scope "Vitest unit coverage": PASS — 16 tests.

## Out-of-scope audit

- Out of scope "1-hop / 2-hop / tag-shared boost scoring math": CLEAN — no `Scorer`, no boost constants, no `RAGEngine` import.
- Out of scope "Cosine / top-K / overlap merge / `RAGEngine.query` plumbing": CLEAN.
- Out of scope "`.canvas` JSON parsing or canvas-sourced edges": CLEAN — canvas paths that surface in `resolvedLinks` are stored verbatim; no parsing logic added.

## QA aggregate
Verdict: PASS — typecheck / lint / 600-tests / build all green.

## Verdict: PASS (runtime wire-up `new GraphCache({metadataCache, plugin, logger})` + `init()` + `shutdown()` parked alongside main.ts integration slice, same pattern as F27 / F29 / F32)
