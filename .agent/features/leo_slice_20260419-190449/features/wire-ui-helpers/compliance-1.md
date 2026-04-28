# Compliance iteration 1 — F67 wire-ui-helpers

## Acceptance criteria

- AC1 (three ui/* orphans reachable from `src/main.ts`): **PASS** — `src/ui/wireUiHelpers.ts` imports from `./notifications`, `./visualStates`, `./toolIcons`; `src/main.ts` imports `wireUiHelpers`. All three modules now traced from the entry point.
- AC2 (`wireUiHelpers` constructs a `Notifications` + exposes `hub`): **PASS** — `src/ui/wireUiHelpers.ts:43-57`; covered by `tests/unit/wireUiHelpers.test.ts > routes hub notice / status / blockingError / confirmation through the injected channels`.
- AC3 (`dispose()` calls `Notifications.dispose()`, idempotent): **PASS** — `src/ui/wireUiHelpers.ts:49-55`; covered by `tests/unit/wireUiHelpers.test.ts > dispose() calls hub.dispose() and is idempotent`.
- AC4 (`applyVisualState` / `ariaHintFor` / `iconFor` / `renderToolIcon` re-exports): **PASS** — `src/ui/wireUiHelpers.ts:40-46`; covered by `tests/unit/wireUiHelpers.test.ts > re-exports the visual-state + tool-icon helpers`.
- AC5 (existing tests stay green; new tests added): **PASS** — 1057/1057, +3 new.

## Scope coverage

- In scope "`wireUiHelpers.ts` constructs `Notifications` with four channels + re-exports": **PASS** — see file and tests.
- In scope "`main.ts.onload` constructs; `onunload` disposes": **PASS** — `src/main.ts` field + construct + dispose.
- In scope "Unit tests for dispatch + dispose": **PASS** — `tests/unit/wireUiHelpers.test.ts`.

## Out-of-scope audit

- Out of scope "Replacing existing `new Notice` callsites": **CLEAN** — no callsites in `indexer`, `reindex`, `threads`, `mcp`, `user tools`, `attachments`, `edit lock`, `skills`, `settings` changed.
- Out of scope "Mounting `applyVisualState` against live ChatView root": **CLEAN** — `ChatView.tsx` not modified.
- Out of scope "Rendering `renderToolIcon` in `MessageList`": **CLEAN** — `MessageList` not modified.
- Out of scope "New visual states / custom icons / i18n": **CLEAN**.

## QA aggregate

`pnpm typecheck` / `pnpm lint` / `pnpm test` (1057/1057) / `pnpm build` (~399 KB) all PASS.

## Integration gate

- Entry point scanned: `src/main.ts`.
- New public module: `src/ui/wireUiHelpers.ts`.
- Anchors matched: `src/main.ts` imports `wireUiHelpers`, `UiHelpersWiring`; construction + dispose reference `this.uiHelpers`.
- Orphan delta: `src/ui/visualStates.ts`, `src/ui/toolIcons.ts`, `src/ui/notifications.ts` all removed from orphan set via transitive import chain from `wireUiHelpers.ts`. Orphan count 41 → 38.

Verdict: PASS.

## Verdict: PASS
