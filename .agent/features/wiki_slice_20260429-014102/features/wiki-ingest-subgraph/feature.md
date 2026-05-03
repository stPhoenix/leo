# F11 — Ingest subgraph FSM + refine sub-agent

## Purpose

The hand-rolled FSM driver wiring every ingest phase plus the PREPARING-phase refine sub-agent. Owns AbortSignal threading, ≤2 s cancel semantics, mid-write completion, and outermost `try/finally` mutex release. Returns a `RunHandle` to the tool wrapper (F12). Covers [context.md `Ingest Subgraph — Phases`](../../context.md#ingest-subgraph--phases) FR-26, FR-33, [context.md `Cancellation`](../../context.md#cancellation) FR-42, FR-43, FR-44, [context.md `Error Handling`](../../context.md#error-handling) FR-45..FR-47, and [context.md `Non-functional requirements`](../../context.md#non-functional-requirements) NFR-01, NFR-05.

## Scope

- In:
  - Refine sub-agent at PREPARING: max 3 clarifying questions (configurable via widget), allowed actions `ask_clarifying_question` / `emit_ingest_plan`, no vault tools (FR-26).
  - FSM driver phasing PREPARING → FETCHING → PERSISTING → PLANNING → EXTRACTING → REDUCING → WRITING → DONE/CANCELLED/ERROR.
  - AbortSignal threaded through `LLM.stream({ signal })` and tool calls.
  - Cancel ≤ 2 s during all non-WRITING phases (FR-42, NFR-01).
  - Cancel during WRITING completes the in-flight per-file write before transitioning, logs `## [<iso>] cancelled-mid-write | <runId>` (FR-43).
  - `RunHandle` returned: `{ runId, abort, terminal: Promise<TerminalResult> }`.
  - Outermost `try/finally` releases the wiki mutex on terminal/abort/throw (FR-25, NFR-05).
  - Per-phase view-model fed to the F06 controller.
- Out: tool wrapper + slash + confirmation (F12); conversation-kind branch (F13).

## Acceptance criteria

1. Refine sub-agent emits ≤ 3 clarifying questions; tool surface is `ask_clarifying_question` / `emit_ingest_plan` only (FR-26).
2. Subgraph reaches DONE on the happy path with all phases run in order (FR-33).
3. Cancel during PREPARING/PLANNING/EXTRACTING/REDUCING transitions to CANCELLED ≤ 2 s wall-clock (FR-42, NFR-01).
4. Cancel during WRITING completes the in-flight file then transitions; remaining queued writes skipped; `cancelled-mid-write` line written to `log.md` (FR-43).
5. On cancel, `terminal` resolves with `{ ok:false, cancelled:true, phase, partial }` (FR-44).
6. Unhandled throw / extractor exhausted retry / total fetch failure → ERROR; best-effort `log.md` entry written; `terminal` resolves with `{ ok:false, error, partial }` (FR-45, FR-46).
7. Successfully written pages and raw entries are not rolled back on subsequent error (FR-47).
8. Mutex acquired before PREPARING; released in outermost `finally` regardless of exit path (FR-25, NFR-05).
9. End-to-end Vitest with canned `AsyncIterable` LLM + fake `VaultAdapter` covers happy-path, cancel, error, duplicate-interrupt (NFR-06).

## Dependencies

- F04 (runId, logging, registry).
- F05 (mutex acquired here).
- F06 (controller view-model surface).
- F08 (fetch + persist + duplicate-detect).
- F09 (planner + extractor + reducer).
- F10 (writer).
- Anchors: [context.md `Ingest Subgraph — Phases`](../../context.md#ingest-subgraph--phases), [context.md `Cancellation`](../../context.md#cancellation), [context.md `Error Handling`](../../context.md#error-handling).

## Implementation notes

- Hand-rolled FSM mirrors `src/agent/externalAgent/subgraph.ts` per [project-structure.md](../../../../standards/project-structure.md). The driver runs as the body of a `delegate_wiki_ingest` tool invocation — one parent agent turn maps to one `WikiIngest RunHandle`, respecting the single-in-flight rule of [architecture.md §1](../../../../architecture/architecture.md#1-architectural-principles).
- Refine sub-agent mirrors `src/agent/externalAgent/refineSubAgent.ts` + `refinePrompt.ts`.
- Tool result shape is `{ ok:true, data }` / `{ ok:false, cancelled:true, ... }` / `{ ok:false, error, ... }` per [architecture.md §4](../../../../architecture/architecture.md#4-key-contracts) `ToolResult` and [architecture.md §7](../../../../architecture/architecture.md#7-error-handling-strategy) — no thrown errors escape the tool boundary.
- AbortSignal threaded through `LLM.stream({signal})` and tool calls per [architecture.md §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) and [code-style.md `Async & Concurrency`](../../../../standards/code-style.md). Plugin unload aborts in-flight runs alongside the global `AgentRunner` cancel.
- `try/finally` in every IO node + outermost mutex release per [code-style.md `Error Handling`](../../../../standards/code-style.md) and [architecture.md §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules).

## Open questions

- OQ-2 — possible planner+refine merge on small models, deferred to Phase 5 per [context.md `Open questions`](../../context.md#open-questions).
