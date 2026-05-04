# F05 — Vault-global wiki mutex

## Purpose

Enforce that at most one ingest **or** lint subgraph is active across the entire vault, with deterministic release on terminal/abort/throw. Covers [context.md `Vault-Global Wiki Mutex`](../../context.md#vault-global-wiki-mutex) FR-23, FR-24, FR-25, NFR-05.

## Scope

- In:
  - `WikiMutex` module exposing `acquire('ingest'|'lint', runId): { ok:true, release } | { ok:false, error:'busy', activeRunId, activeOp }`.
  - `active(): { runId, op } | null` accessor.
  - Acquire/release wired by subgraph drivers (F11, F18) inside an outer `try/finally`.
- Out: queueing, fairness, multi-vault locks.

## Acceptance criteria

1. `acquire(op, runId)` returns `{ok:true, release}` when no holder exists (FR-23).
2. Concurrent acquire from any thread returns `{ok:false, error:'busy', activeRunId, activeOp}` (FR-24).
3. `release()` is idempotent (FR-25).
4. Holder release happens on terminal state, exception, or AbortSignal abort, all routed through the outer `try/finally` (FR-25, NFR-05).
5. Unit tests: contention scenario, release-on-throw, release-on-abort, release-on-double-call.

## Dependencies

- None.
- Anchors: [context.md `Vault-Global Wiki Mutex`](../../context.md#vault-global-wiki-mutex).

## Implementation notes

- `WikiMutex` state is in-memory only — owner of the "active wiki op" record, analogous to `AgentRunner` owning the in-flight queue in [architecture.md §6](../../../../architecture/architecture.md#6-state-ownership). Discarded on plugin unload per [architecture.md §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules).
- Pattern parallels external-agent `slotManager.ts` (per-thread one-slot) but scoped vault-global, per [project-structure.md](../../../../standards/project-structure.md).
- `try/finally` wrapping per [code-style.md `Error Handling`](../../../../standards/code-style.md).
- AbortSignal threading per [code-style.md `Async & Concurrency`](../../../../standards/code-style.md) and [architecture.md §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules).

## Open questions

- None.
