# F09 · canvas-source-planner — Eager source-hint expansion

## Purpose

Expand each `SourceHint` in the `RunPlan` to a concrete deterministic `CanvasSourceItem[]` **before** extraction. `vaultGlob` → minimatch via `VaultAdapter.list`; `vaultTag` → `metadataCache` tag lookup; `vaultFrontmatter` → vault scan filtered by frontmatter field/value; `mention` / `url` / `attachment` / `conversation` → 1:1. Cap at `sourceFanoutMax = 200`; surface dropped count as warning. Sort deterministically: by hint kind, then alpha within kind.

Covers [FR-CANVAS-11](../../context.md#functional-requirements), [FR-CANVAS-12](../../context.md#functional-requirements).

## Scope

**In scope**

- `src/agent/canvas/plan.ts` exporting `expandSourceHints({ hints, vault, metadataCache, attachmentsStore }) → { items: CanvasSourceItem[]; droppedCount: number }`.
- Per-kind expanders:
  - `vaultGlob` → `VaultAdapter.list` recursive scan + minimatch filter (reuse pattern from `globVault.ts`).
  - `vaultTag` → `metadataCache` tag-to-files map.
  - `vaultFrontmatter` → iterate `metadataCache.getFileCache(file).frontmatter` and match `field === value`.
  - `mention` / `url` / `attachment` / `conversation` → identity (1:1 to one `CanvasSourceItem`).
- Deterministic ordering: kind enumeration order (`mention`, `url`, `vaultGlob`, `vaultTag`, `vaultFrontmatter`, `attachment`, `conversation`), then alpha within kind by `resolvedRef`.
- Dedupe: same `resolvedRef` from multiple hints collapses to a single source item (first-wins; remaining `hints` recorded for diagnostics).
- Hard cap: truncate to `sourceFanoutMax` after sorting; `droppedCount = total - kept`.

**Out of scope**

- Source body fetching — F10.
- Source body extraction — F11.

## Acceptance criteria

1. `vaultGlob: '**/*.md'` returns every markdown file in the fake vault, sorted alphabetically, capped at `sourceFanoutMax` — traces to FR-CANVAS-11, FR-CANVAS-12.
2. `vaultTag: '#meeting'` returns only files tagged `#meeting` per `metadataCache` — traces to FR-CANVAS-11.
3. `vaultFrontmatter: { field: 'type', value: 'event' }` returns files whose frontmatter `type` equals `event` — traces to FR-CANVAS-11.
4. Three hints producing 250 distinct sources → returned items have length 200, `droppedCount = 50` — traces to FR-CANVAS-12.
5. Same path matched by two hints (e.g., glob + tag) appears once; `items[i].hint` records the first-resolved hint — traces to FR-CANVAS-12 (deterministic order).
6. Output is byte-stable across re-runs given same vault snapshot (verified by snapshot test against `tinyVault`).
7. `attachment` hint uses `attachmentsStore` lookup (placeholder when attachments slice not active in test).

## Dependencies

- [../canvas-budgets-runid-slug/feature.md](../canvas-budgets-runid-slug/feature.md) — `sourceFanoutMax`.
- Forward consumers: [../canvas-source-fetcher/feature.md](../canvas-source-fetcher/feature.md), [../canvas-subgraph/feature.md](../canvas-subgraph/feature.md).
- Requirements traced: [../../context.md#functional-requirements](../../context.md#functional-requirements) FR-CANVAS-11, FR-CANVAS-12.

## Implementation notes

- [../../../../architecture/architecture.md#3-modules](../../../../architecture/architecture.md#3-modules) — domain module placement; `MetadataCache` first, file content last.
- [../../../../architecture/architecture.md#5-data-flows](../../../../architecture/architecture.md#5-data-flows) — eager expansion vs. lazy: SRS mandates eager (snapshot semantic).
- [../../../../standards/code-style.md#obsidian-plugin-patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) — `MetadataCache` usage rule.
- [../../../../standards/best-practices.md#core-principles](../../../../standards/best-practices.md#core-principles) — DRY: reuse existing `globVault` minimatch helper if extractable.

## Open questions

- Should glob enumeration honor the existing `excludeListStore` (RAG excludes)? No — canvas sources are user-instructed and should not silently shrink to RAG excludes. Note as docs-friction risk; revisit at Phase 6.
- How to disambiguate when `vaultFrontmatter` field is an array (e.g., `tags: [a, b]`)? Test array-membership match; document in `.describe()`.
