# F18 — Lint subgraph FSM

## Purpose

The hand-rolled FSM driver wiring SCANNING → CHECKING → PROPOSING → CONFIRMING → WRITING → DONE/CANCELLED/ERROR. Owns AbortSignal threading, ≤2 s cancel, mid-write completion, mutex release in outermost `try/finally`, and per-phase view-model fed to the F06 controller. Covers [context.md `Lint Subgraph — Phases`](../../context.md#lint-subgraph--phases) FR-39, [context.md `Cancellation`](../../context.md#cancellation) FR-42..FR-44, [context.md `Error Handling`](../../context.md#error-handling) FR-45..FR-47, and [NFR-01 / NFR-05](../../context.md#non-functional-requirements).

## Scope

- In:
  - FSM driver wiring scan → check → propose → confirm → write → terminal.
  - AbortSignal threaded through `LLM.stream({ signal })` and tool calls.
  - Cancel ≤ 2 s during all non-WRITING phases (FR-42, NFR-01).
  - Cancel during WRITING completes the in-flight per-file write before transitioning, logs `cancelled-mid-write` (FR-43).
  - `RunHandle` returned: `{ runId, abort, terminal: Promise<TerminalResult> }`.
  - Outermost `try/finally` releases the wiki mutex on terminal/abort/throw (FR-25, NFR-05).
  - CONFIRMING phase awaits user decision via LangGraph `interrupt()`, resumed by F19's UI handlers.
  - Per-phase view-model fed to F06 controller.
- Out: scan / check / propose nodes (F16/F17); confirm UI + writer + tool wrapper (F19).

## Acceptance criteria

1. Subgraph reaches DONE on the happy path (FR-39).
2. Cancel during SCANNING/CHECKING/PROPOSING/CONFIRMING transitions to CANCELLED ≤ 2 s (FR-42, NFR-01).
3. Cancel during WRITING completes current file then transitions; `cancelled-mid-write` logged (FR-43).
4. ERROR semantics parallel ingest: best-effort `log.md` entry, terminal `{ok:false, error, partial}` (FR-45, FR-46).
5. Successfully written pages are not rolled back on subsequent error (FR-47).
6. Mutex released in outermost `try/finally` (FR-25, NFR-05).
7. CONFIRMING awaits via `interrupt()` and resumes on Apply selected / Reject all from F19 (FR-37 surface).
8. End-to-end Vitest with canned LLM + fake `VaultAdapter` covers happy-path / cancel / error.

## Dependencies

- F04 (runId, logging).
- F05 (mutex acquired here).
- F06 (view-model surface).
- F16 (scan).
- F17 (checkers + propose).
- Anchors: [context.md `Lint Subgraph — Phases`](../../context.md#lint-subgraph--phases), [context.md `Cancellation`](../../context.md#cancellation), [context.md `Error Handling`](../../context.md#error-handling).

## Implementation notes

- Hand-rolled FSM mirrors `src/agent/externalAgent/subgraph.ts` per [project-structure.md](../../../../standards/project-structure.md). The driver runs inside the `delegate_wiki_lint` tool invocation; tool result shape is the standard `ToolResult` per [architecture.md §4](../../../../architecture/architecture.md#4-key-contracts).
- AbortSignal threaded per [architecture.md §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) and [code-style.md `Async & Concurrency`](../../../../standards/code-style.md).
- `try/finally` in every IO node + outermost mutex release per [code-style.md `Error Handling`](../../../../standards/code-style.md) and [architecture.md §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules).
- CONFIRMING uses LangGraph `interrupt()` to await user decision — the canonical pause-for-confirmation pattern per [architecture.md §1](../../../../architecture/architecture.md#1-architectural-principles).

## Open questions

- None.
