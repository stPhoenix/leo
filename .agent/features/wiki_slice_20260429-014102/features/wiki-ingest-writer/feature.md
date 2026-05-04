# F10 — Ingest writer

## Purpose

The deterministic writer that applies reducer outputs (and source summaries) to the vault: page creates → page edits → `sources/` summaries → `index.md` regenerate → `log.md` append, with per-file atomicity. Covers [context.md `Ingest Subgraph — Phases`](../../context.md#ingest-subgraph--phases) FR-32.

## Scope

- In:
  - Apply page creates first, then page edits, then `sources/` summary writes (one per ingested raw entry), then regenerate `index.md` from current `pages/`, then append a `log.md` entry (FR-32).
  - Per-file atomic writes via `VaultAdapter`.
  - Mid-phase failure leaves prior writes; the run continues then transitions to terminal `error` (FR-32, FR-46).
  - `sources/` summary frontmatter cites `raw_path` per [context.md `Bootstrap & Layout`](../../context.md#bootstrap--layout) FR-04.
- Out: extractor / reducer logic (F09); FSM driver (F11); lint writer reuse (concern of F19, which depends on this).

## Acceptance criteria

1. Writer applies in deterministic order (FR-32).
2. Mid-phase write failure leaves prior writes; run continues, terminal error logged (FR-32, FR-46).
3. `index.md` is regenerated from current `pages/` on every successful WRITING (FR-34 ref — index regen happens on ingest, never on lint).
4. `log.md` append never overwrites; existing entries preserved (FR-46).
5. `sources/` summary frontmatter cites the corresponding `raw_path`.
6. Unit tests cover happy path, partial write failure, deterministic ordering with sorted keys.

## Dependencies

- F04 (logging namespaces).
- F08 (raw entries written, sha256 frontmatter consumed).
- F09 (reducer outputs).
- Anchors: [context.md `Ingest Subgraph — Phases`](../../context.md#ingest-subgraph--phases).

## Implementation notes

- Per-file atomic write via `VaultAdapter` per [architecture.md §3.4](../../../../architecture/architecture.md#34-adapters) and [tech-stack.md `Platform APIs`](../../../../standards/tech-stack.md).
- Deterministic iteration via sorted keys per [code-style.md `LangGraph / Agent Layer`](../../../../standards/code-style.md) (purity of write ordering).
- Per-write failure surfaces as a tool-error in the parent FSM, matching [architecture.md §7](../../../../architecture/architecture.md#7-error-handling-strategy); no global rollback (FR-47).

## Open questions

- None.
