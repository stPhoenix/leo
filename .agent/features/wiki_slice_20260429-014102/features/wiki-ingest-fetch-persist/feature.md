# F08 — Ingest FETCHING + PERSISTING + duplicate-detect

## Purpose

Per-source fetch (URL via inline-agent chain, vault path via `VaultAdapter`, attachment via the chat attachment store), SHA-256 + frontmatter raw write, and LangGraph `interrupt()`-based duplicate-detect with a 60 s default-to-Skip timeout. Covers [context.md `Ingest Subgraph — Phases`](../../context.md#ingest-subgraph--phases) FR-27, FR-28 and [context.md `Re-ingest Detection`](../../context.md#re-ingest-detection) FR-40, FR-41.

## Scope

- In:
  - URL fetch reusing `src/agent/externalAgent/adapters/inlineAgent/tools/{ipGuard,sanitize,untrustedWrap}.ts`.
  - Vault-path read via `VaultAdapter`; attachment read from chat attachment store.
  - Per-source error isolation — failure of one source does not abort the batch (FR-27).
  - SHA-256 over fetched body via the existing Web Crypto path (NFR-04 — no new dep).
  - Raw write at `wiki/raw/<YYYYMMDD>-<slug>.md` with frontmatter `{source, fetched_at, content_type, sha256, original_path?}`; immutable post-write (FR-28).
  - Duplicate detection via existing-raw frontmatter scan; on collision, LangGraph `interrupt()` surfaces `Skip / Re-process / Replace` choice through the F06 controller view-model (FR-40).
  - 60 s default-to-Skip timeout (`reingestPromptTimeoutMs`) (FR-41).
- Out: extract / reduce / write phases; conversation-kind branch (F13); inbox-kind drain (F15).

## Acceptance criteria

1. URL fetch routes through the inline-agent network/sanitize chain; SSRF + DNS-rebind protections still apply (FR-27).
2. Vault path read via `VaultAdapter`; attachment via the chat attachment store (FR-27).
3. Per-source fetch failure marks that source `error` and the batch continues (FR-27).
4. PERSISTING writes raw file with required frontmatter; raw files are never modified after write (FR-28).
5. SHA-256 collision → LangGraph `interrupt()`; choice surface flows through the F06 view-model (FR-40).
6. No user response within 60 s defaults to Skip and continues (FR-41).
7. Re-process re-runs extract+reduce against the existing raw entry without writing a new raw; Replace overwrites (FR-40).
8. Unit tests cover: per-source error isolation, frontmatter shape, duplicate-collision branch, default-to-Skip timeout.

## Dependencies

- F01 (layout exists).
- F04 (logging namespaces, runId).
- F05 (mutex must be held by caller — driver concern in F11; this feature does not acquire on its own).
- Anchors: [context.md `Ingest Subgraph — Phases`](../../context.md#ingest-subgraph--phases), [context.md `Re-ingest Detection`](../../context.md#re-ingest-detection).

## Implementation notes

- URL fetch reuses inline-agent network/sanitize entry points at `src/agent/externalAgent/adapters/inlineAgent/tools/` per [project-structure.md](../../../../standards/project-structure.md); SSRF + DNS-rebind protections enforced inside that chain.
- Vault path read goes through `VaultAdapter`; attachment resolution via the typed accessor injected through `ToolCtx` (no direct import from `src/chat/`, keeping the agent → chat back-edge closed per [architecture.md §1](../../../../architecture/architecture.md#1-architectural-principles)).
- Duplicate-detect uses LangGraph `interrupt()`, the canonical confirmation/pause pattern per [architecture.md §1](../../../../architecture/architecture.md#1-architectural-principles) and [tech-stack.md `Agent / Tool / Skill / MCP Wiring`](../../../../standards/tech-stack.md).
- AbortSignal threaded through `LLM.stream({signal})` and tool `invoke(ctx)` per [architecture.md §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) and [code-style.md `Async & Concurrency`](../../../../standards/code-style.md); explicit timeouts on every fetch.
- All FS writes via `VaultAdapter` per [architecture.md §3.4](../../../../architecture/architecture.md#34-adapters) and [tech-stack.md `Platform APIs`](../../../../standards/tech-stack.md).

## Open questions

- None.
