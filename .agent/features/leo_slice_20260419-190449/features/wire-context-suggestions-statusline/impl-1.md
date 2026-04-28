# Impl iteration 1 — F68 wire-context-suggestions-statusline

## Summary

Scope narrowed in `feature.md` following the F62–F64 precedent: this slice closes the `ui/contextSuggestions.ts` orphan by standing up a `wireContextStatusLine` helper that mounts a debounced Obsidian status-bar item on plugin load. The helper formats `StatusLineContext` values via a shared `formatStatusLine`, and re-exports `generateContextSuggestions` / `sortSuggestions` / `buildStatusLineContext` so future consumers import from one place. Ribbon UI, `/context` grid suggestion plumbing, threshold-crossing Notices, and action handlers are deferred to a follow-up slice per rule §7. Until the live context source is plumbed in, the `build` callback supplied by `main.ts` returns `null` — the status bar stays empty but the wire is in place.

## Files touched

- `src/ui/wireContextStatusLine.ts` — new, 77 lines.
- `src/main.ts` — import `wireContextStatusLine` + `ContextStatusLineWiring`, add `contextStatusLine` field, construct before `wireUiHelpers`, dispose in `onunload`.
- `tests/unit/wireContextStatusLine.test.ts` — new, 3 cases using injected fake timers (format, debounce+trigger, idempotent dispose).

## Tests added or updated

- `tests/unit/wireContextStatusLine.test.ts`. 1060/1060 pass.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- Narrowed from the original spec's ribbon + /context + action-handler reach; all deferred to a follow-up wiring slice.
- `build` callback is a `() => null` stub in `main.ts`; a later slice will replace it with a context source derived from `AgentRunner` / `ConversationStore`.

## Assumptions

- `this.addStatusBarItem()` returns an Obsidian element with `setText` + `detach`; the adapter uses those two APIs only.
- Future follow-up slice will thread a live `build` callback and add the ribbon + threshold transitions.

## Open questions

None — the feature-md question on per-turn dismissibility defers with the ribbon UI.
