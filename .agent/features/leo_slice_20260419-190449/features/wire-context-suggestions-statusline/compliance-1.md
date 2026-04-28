# Compliance iteration 1 — F68 wire-context-suggestions-statusline

## Acceptance criteria

- AC1 (orphan `ui/contextSuggestions.ts` reachable from `src/main.ts`): **PASS** — `src/ui/wireContextStatusLine.ts` imports `buildStatusLineContext`, `createDebouncedStatusLineUpdater`, `generateContextSuggestions`, `sortSuggestions` from `./contextSuggestions`; `src/main.ts` imports `wireContextStatusLine`.
- AC2 (creates a status-bar element + debounced updater; formats when `build` returns non-null): **PASS** — `src/ui/wireContextStatusLine.ts:38-66`; `formatStatusLine(ctx)` produces the `tokens / budget — remaining %` string. Covered by `tests/unit/wireContextStatusLine.test.ts > formatStatusLine renders tokens/budget and remaining %` and `> trigger() debounces write`.
- AC3 (`trigger()` coalesces within debounce; `dispose()` halts pending): **PASS** — underlying `createDebouncedStatusLineUpdater` handles coalescing; covered by `tests/unit/wireContextStatusLine.test.ts > trigger() debounces write` (single pending timer after two triggers) and `> dispose() halts future writes`.
- AC4 (re-exports `generateContextSuggestions`, `sortSuggestions`, `buildStatusLineContext`): **PASS** — `src/ui/wireContextStatusLine.ts:59-63`; covered by `> trigger()` test asserts typeof each re-export.
- AC5 (existing tests stay green; new tests added): **PASS** — 1060/1060 with 3 new cases.

## Scope coverage

- In scope "`wireContextStatusLine.ts` creates `addStatusBarItem` + `createDebouncedStatusLineUpdater` (500ms default)": **PASS**.
- In scope "`build` callback supplied by caller; formats via `buildStatusLineContext`": **PASS** — callback is injected; helper re-exports `buildStatusLineContext` for callers to feed it.
- In scope "`main.ts.onload` constructs; `onunload` disposes": **PASS** — `contextStatusLine` field + construct + dispose.
- In scope "Unit tests: trigger + debounce; write formatting; dispose stops writes": **PASS**.

## Out-of-scope audit

- Out of scope "ChatView `ContextSuggestionsRibbon` DOM": **CLEAN** — `ChatView.tsx` not modified.
- Out of scope "`/context` grid suggestion list plumbing": **CLEAN** — F47 grid untouched.
- Out of scope "Threshold-crossing `Notice` dispatch": **CLEAN**.
- Out of scope "Concrete suggestion-action handlers": **CLEAN**.
- Out of scope "New suggestion types / cross-session history / per-model overrides": **CLEAN**.

## QA aggregate

`pnpm typecheck` / `pnpm lint` / `pnpm test` (1060/1060) / `pnpm build` (~403 KB) all PASS.

## Integration gate

- Entry point scanned: `src/main.ts`.
- New public module: `src/ui/wireContextStatusLine.ts`.
- Anchors matched: `src/main.ts` imports `wireContextStatusLine`, `ContextStatusLineWiring`; constructs `this.contextStatusLine`.
- Orphan delta: `src/ui/contextSuggestions.ts` removed from orphan set (now reachable via `wireContextStatusLine.ts`). Orphan count 38 → 37.

Verdict: PASS.

## Verdict: PASS
