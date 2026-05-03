# F01 — Wiki bootstrap, layout, seeds, RAG exclusion

## Purpose

On plugin load, idempotently materialize the fixed wiki layout, seed user-editable content once, and ensure `wiki/` is excluded from RAG at both registration and intake. Establishes the on-disk contract every later feature depends on. Covers [context.md `Bootstrap & Layout`](../../context.md#bootstrap--layout) FR-01..FR-06 and [NFR-09](../../context.md#non-functional-requirements).

## Scope

- In:
  - Ensure `wiki/`, `wiki/raw/`, `wiki/sources/`, `wiki/pages/`, `wiki-inbox.md` exist (FR-01).
  - First-run-only seed of `wiki/introduction.md`, `wiki/SCHEMA.md`, `wiki/index.md`, `wiki/log.md` from `src/agent/wiki/seed/{introduction,schema}.ts` (FR-02, FR-03, FR-04).
  - Register `wiki/` in `excludeListStore` (FR-05).
  - Filter `wiki/` at `dirtyQueue` intake (FR-05).
  - Hard-coded folder/inbox names — no settings field (FR-06).
- Out: tools, subgraphs, widgets, inbox parsing, search.

## Acceptance criteria

1. On first run on an empty vault, all five paths plus four seed files exist (FR-01, FR-02).
2. On subsequent loads, no existing file is overwritten; missing dirs are recreated (FR-01, FR-02).
3. `excludeListStore` contains `wiki/` after `onload`; re-registration is a no-op (FR-05).
4. `dirtyQueue` discards intake entries whose vault-relative path begins with `wiki/` (FR-05).
5. Bootstrap operates on symlinked `wiki/`, Obsidian-synced folders, and fresh empty dirs (NFR-09).
6. No new user-configurable settings field, command, or slash entry is added (FR-06).
7. `introduction.md` content matches the agent–user authoring policy text (FR-03); `SCHEMA.md` content matches the page/citation/frontmatter conventions (FR-04). Both originate from compiled-in seed modules.

## Dependencies

- None (root feature).
- Anchors: [context.md `Bootstrap & Layout`](../../context.md#bootstrap--layout), [context.md `Constraints`](../../context.md#constraints).

## Implementation notes

- `bootstrap.ts` is invoked from `main.ts` `onload` alongside the existing startup steps in [architecture.md §5.1](../../../../architecture/architecture.md#51-plugin-startup); lifecycle convention per [code-style.md `Obsidian Plugin Patterns`](../../../../standards/code-style.md).
- All FS access goes through `VaultAdapter`, the sole Obsidian-`Vault` adapter per [architecture.md §3.4](../../../../architecture/architecture.md#34-adapters) and [tech-stack.md `Platform APIs`](../../../../standards/tech-stack.md).
- The `wiki/`-intake filter sits at the indexer caller (the side that adds to `dirtyQueue`); `dirtyQueue` itself stays a pure state machine per [architecture.md §3.3](../../../../architecture/architecture.md#33-domain--core-pure).
- `excludeListStore`, `dirtyQueue`, and seed-module locations per [project-structure.md](../../../../standards/project-structure.md).
- Symlink + Obsidian-sync tolerance lives in `VaultAdapter`; no FS-specific code in this feature per [tech-stack.md `Platform APIs`](../../../../standards/tech-stack.md).

## Open questions

- None for F01.
