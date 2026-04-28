# F68 — Wire context suggestions + token status line

## Purpose

Close the integration gap left by F48. `ui/contextSuggestions.ts` (`generateContextSuggestions`, `buildStatusLineContext`) ships pure but is not invoked by any reachable file. This feature wires a debounced status-bar widget that reports token / usage / remaining and surfaces `/context` suggestions as a warning ribbon inside the `ChatView` and as actionable hints in the existing `/context` command grid (F47).

## Scope

Scope narrowed following the F62–F64 precedent: this slice closes the `ui/contextSuggestions.ts` orphan by standing up a `wireContextStatusLine` helper that mounts a debounced Obsidian status-bar item on load. Ribbon UI, `/context` suggestion ordering plumbing into the live React command, threshold `Notice` transitions, and concrete action handlers are deferred to a follow-up slice.

### In scope

- New `src/ui/wireContextStatusLine.ts` helper that:
  - Creates an Obsidian `addStatusBarItem` element and wires it to `createDebouncedStatusLineUpdater` with a 500ms default debounce.
  - Accepts a `build: () => StatusLineContext | null` callback supplied by the caller; formats the context via `buildStatusLineContext` when the caller supplies raw usage.
  - Returns `{ trigger, statusEl, generateSuggestions, sortSuggestions, buildStatusLineContext, dispose }`.
- `main.ts.onload` constructs the wiring (passing a `build` callback returning `null` until the live context source is plumbed in); `onunload` disposes.
- Unit tests: trigger + debounce; writer writes formatted text; dispose stops future writes.

### Out of scope

- ChatView `ContextSuggestionsRibbon` DOM.
- `/context` grid suggestion list (F47 owns the grid).
- Threshold-crossing `Notice` dispatch.
- Concrete suggestion-action handlers (compact, prune memory, etc.).
- New suggestion types beyond those F48 codifies.
- Cross-session suggestion history.
- Per-model budget overrides.

## Acceptance criteria

1. Orphan `ui/contextSuggestions.ts` becomes reachable from `src/main.ts`; §5.4 audit removes it.
2. `wireContextStatusLine` creates an Obsidian status-bar element and registers a debounced updater (500ms default) that writes formatted `tokens / budget — remaining %` when the caller's `build` returns a non-null `StatusLineContext`.
3. `trigger()` coalesces writes within the debounce window; `dispose()` halts pending writes.
4. The wiring re-exports `generateContextSuggestions`, `sortSuggestions`, `buildStatusLineContext` for downstream consumers.
5. All existing tests stay green; new tests added per §Scope.

## Dependencies

F42 (microcompact) · F43 (autocompact) · F46 (context analyzer) · F47 (context command + grid) · F48 (suggestions + status-line domain). All `feature-complete`. Likely runs after F60/F61/F62 so suggestion handlers target wired subsystems.

## Implementation notes

- [Architecture §3.2 UI — Status bar](../../../../architecture/architecture.md#32-ui) — status-bar items are owned by `main.ts` and disposed on unload.
- F48 compliance-1 calls out "React/status-bar mount parked pending main.ts".

## Open questions

- Should the ribbon be dismissible per session (with a "don't show again this turn" affordance)? Default: dismissible per turn; reappears next turn if still warranted.
