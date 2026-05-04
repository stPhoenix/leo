# F07 — `search_wiki` in-progress warning

## Purpose

When the wiki mutex is held, `search_wiki` results carry an in-band warning and a rate-limited toast surfaces in the UI so the user knows results may be partial. Covers [context.md `Routing & Wiki Search`](../../context.md#routing--wiki-search) FR-14.

## Scope

- In:
  - Inject `warning: "warning: wiki <op> in progress (runId=<id>) — results may be partial"` into the `SearchWikiResult` whenever `WikiMutex.active()` is non-null (FR-14).
  - Emit an Obsidian `Notice` toast at most once per minute per `threadId` while the mutex is held (FR-14).
  - Reads continue to be served regardless of mutex state (FR-14).
- Out: blocking on the mutex; modifying any read behavior beyond the warning.

## Acceptance criteria

1. While `WikiMutex.active()` returns non-null, every `search_wiki` invocation includes the `warning` field with the exact wording (FR-14).
2. The same string is surfaced as a `Notice` toast at most once per minute per `threadId` (FR-14).
3. Reads succeed normally with the warning attached (FR-14).
4. While mutex is idle, no warning, no toast.
5. Unit tests cover both the result-injection branch and the rate limiter.

## Dependencies

- F02 (`search_wiki` exists).
- F05 (`WikiMutex.active()` exists).
- Anchors: [context.md `Routing & Wiki Search`](../../context.md#routing--wiki-search).

## Implementation notes

- Warning injection lives in the tool implementation (agent layer), not in any UI component — keeps layer order clean per [architecture.md §1](../../../../architecture/architecture.md#1-architectural-principles) and [code-style.md `Imports & Module Boundaries`](../../../../standards/code-style.md).
- Rate limiter via a small per-thread timestamp map; reuse `src/util/debounce.ts` style if applicable, per [project-structure.md](../../../../standards/project-structure.md).
- `Notice` API per [tech-stack.md `Platform APIs`](../../../../standards/tech-stack.md).

## Open questions

- None.
