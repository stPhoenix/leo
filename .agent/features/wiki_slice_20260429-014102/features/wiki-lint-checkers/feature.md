# F17 — Lint CHECKING + PROPOSING phases

## Purpose

Per-concern checker subagents (contradiction, stale, orphan, missing-page, missing-xref, research-gap, schema-drift), then aggregate + rank into a `LintPatch[]` plus a separate `schemaPatch` field. Covers [context.md `Lint Subgraph — Phases`](../../context.md#lint-subgraph--phases) FR-35, FR-36.

## Scope

- In:
  - Checker subagents per concern; each Zod-validated; retry-once-then-mark-error (NFR-07).
  - Concerns: `contradiction`, `stale`, `orphan-page`, `orphan-raw`, `missing-page` (entities mentioned in ≥ K=3 pages without their own page), `missing-xref`, `research-gap` (advisory: `severity:'info'`, `patch:null`, `suggestedQueries[]`), `schema-drift` (FR-35).
  - Aggregator returns `{ findings: LintFinding[], patches: LintPatch[], schemaPatch: LintSchemaPatch | null }` (FR-36).
  - Schema-edit proposals emitted as a separate `schemaPatch` field — never inline page edits (FR-36).
  - Concurrency cap via the shared semaphore module from F09 (NFR-08).
  - Token caps per `checkerInputCap=6000`, `checkerOutputCap=1500` (NFR-10).
- Out: confirmation UI + writer (F19); FSM driver (F18).

## Acceptance criteria

1. Each checker registered as a separate node and outputs `LintFinding[]` (FR-35).
2. `research-gap` findings emit `severity:'info'`, `patch:null`, `suggestedQueries[]` and are advisory only (FR-35).
3. Aggregator returns the documented shape with `schemaPatch` separate from inline page edits (FR-36).
4. Token caps + Zod retry semantics hold (NFR-07, NFR-10).
5. Concurrency enforced via semaphore module (NFR-08).
6. End-to-end testable with canned LLM + fake `VaultAdapter` (NFR-06).

## Dependencies

- F04 (budgets, logging).
- F16 (scan output: adjacency + orphan lists).
- Anchors: [context.md `Lint Subgraph — Phases`](../../context.md#lint-subgraph--phases).

## Implementation notes

- Zod schemas `LintFinding`, `LintPatch`, `LintSchemaPatch` are described in the SRS — see [context.md `Functional requirements`](../../context.md#functional-requirements) §8.3.
- Intra-tool fan-out (per-concern checkers) sits inside one parent tool invocation — does not bypass the single-in-flight rule per [architecture.md §1](../../../../architecture/architecture.md#1-architectural-principles).
- LangChain subpath imports per [code-style.md `LangGraph / Agent Layer`](../../../../standards/code-style.md).
- Shared semaphore module from F09 reused per [code-style.md `Async & Concurrency`](../../../../standards/code-style.md).

## Open questions

- None.
