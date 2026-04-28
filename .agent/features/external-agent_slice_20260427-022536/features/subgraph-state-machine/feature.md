# F03 — Subgraph state + state machine

## Purpose

Define the typed state shape `ExternalAgentState`, build the LangGraph `StateGraph` skeleton with stub nodes for every phase in [`.agent/srs/external-agent.md`](../../../../srs/external-agent.md) §5, and enforce per-thread one-slot concurrency. Provide a mock-adapter unit harness so downstream features (refine, run, widget) can be tested in isolation against a deterministic state machine.

Implements [`context.md`](../../context.md) FR-EXT-05, FR-EXT-06, NFR-EXT-08.

## Scope

**In scope**
- `src/agent/externalAgent/state.ts`: `ExternalAgentState` (matches [`.agent/srs/external-agent.md`](../../../../srs/external-agent.md) §6) + Zod parser for the persisted subset (the parts that survive into `messageStore`, scoped by F12).
- `src/agent/externalAgent/subgraph.ts`: `buildExternalAgentGraph(deps)` returns a compiled LangGraph with nodes `prepare`, `awaitClarify`, `ready`, `run`, `write`, `terminal` and the transitions in §5. Phase-specific work (LLM call, adapter call, vault write) is deferred to injected dependencies — F03 itself wires only the state machine + transition guards.
- Per-thread slot manager: `Map<threadId, RunHandle>` exposing `acquire(threadId): RunHandle | 'busy'`, `release(threadId)`. Single in-process registry, owned by the subgraph module.
- `MockAdapter` test helper that yields a scripted `AsyncIterable<ExternalEvent>` from a fixture array. Lives in `tests/unit/externalAgent/_mockAdapter.ts`.
- Vitest suite covering: state transitions for happy path, cancel from each phase, busy-slot rejection, terminal-state idempotency.

**Out of scope**
- Refine sub-agent LLM call wiring (F04).
- Real adapter call wiring (F05).
- Widget projection (F07).
- Persistence (F12).

## Acceptance criteria

1. `ExternalAgentState` field set matches §6 of the SRS verbatim (no field added or removed without updating SRS first).
2. `buildExternalAgentGraph` compiles and runs end-to-end against the mock adapter without any LLM, vault, or HTTP I/O — proves NFR-EXT-08.
3. Slot manager: `acquire(threadId)` returns a `RunHandle` on first call; subsequent calls for the same `threadId` (while handle live) return `'busy'` carrying the live `runId`. `release(threadId)` is idempotent. Honors FR-EXT-05, FR-EXT-06.
4. Cancel: invoking `RunHandle.cancel()` from any non-terminal phase drives the graph to `CANCELLED` within ≤ 50 ms in the test harness (real-clock budget separately enforced by NFR-EXT-01 via F05 once the adapter call exists).
5. Once the graph reaches `DONE`, `CANCELLED`, or `ERROR`, further events are ignored (no state mutation). Terminal states are sticky.
6. `runId` generated as `YYYYMMDD-HHmmss-<6-char-ulid-tail>` per [`.agent/srs/external-agent.md`](../../../../srs/external-agent.md) §8. Generation isolated in a single helper for testability (`vi.useFakeTimers` friendly).

## Dependencies

- **F01** — graph nodes accept `AdapterRegistry` for adapter lookup at the boundary of F05's work (stub in F03).
- Cross-doc:
  - [`context.md#fr-ext-05`](../../context.md#functional-requirements)
  - [`../adapter-contract/feature.md`](../adapter-contract/feature.md)

## Implementation notes

- LangGraph patterns — `StateGraph` build + typed state + `interrupt()` per [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §"LangGraph / Agent Layer".
- One-in-flight: per-thread subgraph slot is additive scope on top of the global rule in [`.agent/architecture/architecture.md`](../../../../architecture/architecture.md) §1 — full reasoning in [`features-index.md`](../../features-index.md) §"Architecture compliance summary".
- Module placement — `src/agent/externalAgent/` under Agent layer per [`.agent/architecture/architecture.md`](../../../../architecture/architecture.md) §2 / §3.2.
- AsyncLocalStorage init for langgraph interrupts — already handled in `src/platform/asyncLocalStorageInit.ts`; verify side-effect import is loaded before subgraph instantiation per project layout in [`.agent/standards/project-structure.md`](../../../../standards/project-structure.md).
- Pure-where-possible — keep node bodies side-effect-free except for the IO-edge nodes per [`.agent/architecture/architecture.md`](../../../../architecture/architecture.md) §1 ("Pure core, IO at edges").

## Open questions

- **OQ-01-F03** Should the slot manager be process-global or scoped to a `LeoContext` instance (would matter for multi-vault Obsidian setups). **Proposed**: scoped to `LeoContext` — matches existing per-plugin singletons.
- **OQ-02-F03** Where to source `runId`'s ULID tail: `crypto.randomUUID()` slice vs a dedicated ULID lib. **Proposed**: `crypto.randomUUID().slice(0, 6)` — zero new dependency, satisfies NFR-EXT-06.
