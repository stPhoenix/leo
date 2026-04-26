# Compliance iteration 1 — F02 rag-widget

## Acceptance criteria

- AC1: PASS — `registerWidget('rag', RagWidget)` is called at module-evaluation in `src/ui/chat/widgets/RagWidget.tsx:225`. Side-effect import `import './chat/widgets/RagWidget'` added to `src/ui/chatView.tsx:55` (mirrors the existing `ContextWidget` registration pattern at line 54), so the registry contains the `'rag'` kind by the time the chat view mounts.
- AC2: PASS — When `storeAvailable === false`, `pickVariant()` returns `'unavailable'` (`src/ui/chat/widgets/RagWidget.tsx:51`); the body renders `RagUnavailable` exclusively (no stat table) with `data-slot="rag-unavailable"`.
- AC3: PASS — When `chunkCount === 0` and the indexer is idle, `pickVariant()` returns `'empty'` (line 56) and `RagEmpty` renders `data-slot="rag-empty"` plus a dimmed stat table (zero counts).
- AC4: PASS — `RagProgressRow` renders only when `snapshot.indexerStatus.phase === 'draining'` (`src/ui/chat/widgets/RagWidget.tsx:33`), exposes `data-slot="rag-progress"`, and uses `basename()` for the current path display.
- AC5: PASS — All numeric values flow through `fmt(n) = n.toLocaleString('en-US')`. Byte values use `fmtBytes` with locale-friendly units (B/KB/MB/GB).
- AC6: PASS — `src/ui/chat/widgets/RagWidget.tsx` imports only `RagSnapshot` (type) from `@/rag/ragSnapshot`, `IndexerPhase` (type) from `@/indexer/indexerStatusTap`, and the local `./registry` module. No imports from `obsidian`, `idb`, or `src/storage/`.
- AC7: PASS — `src/ui/chat/widgets/RagWidget.stories.tsx` defines seven stories: `Idle`, `IndexingInProgress`, `PausedOnUser`, `Errored`, `Unavailable`, `Empty`, `LargeVault`. Each provides a fully-static `RagWidgetPayload`. Build succeeds; typecheck succeeds.
- AC8: PASS — All new CSS rules use the `leo-rag-widget-*` namespace, no `!important`. Colour tokens via Obsidian variables (`--text-normal`, `--text-error`, `--text-accent`, `--text-warning`, `--color-yellow`, `--color-red`, `--background-modifier-border`, `--background-primary-alt`, `--font-interface`, `--font-ui-smaller`, `--radius-l/m/s`, `--size-4-*`).
- AC9: PASS — `package.json` runtime `dependencies` block unchanged (no new entries added by this iteration); the only new code is component + stories + CSS.
- AC10: PASS — All component code uses named exports (`export function RagWidget`, `export interface RagWidgetPayload`); no class components, no default export. Component is hookless; the hooks-order rule is vacuously satisfied.

## Scope coverage

- In scope "New file `src/ui/chat/widgets/RagWidget.tsx`": PASS — file present.
- In scope "Visual states (idle/indexing/paused/errored/unavailable/empty/large vault)": PASS — `pickVariant` enumerates them; stories exercise every one.
- In scope "New file `src/ui/chat/widgets/RagWidget.stories.tsx`": PASS — present with seven stories.
- In scope "CSS / Tailwind utilities scoped under `.leo-root` with class names prefixed `leo-rag-widget-*`": PARTIAL — class names use the prefix, no `!important`, all Obsidian CSS variables. Tailwind utilities not used (custom CSS extends the existing `ContextWidget` pattern); documented as deviation in `impl-1.md`. The styles are added next to the existing `leo-context-widget-*` block in `styles.css`.

## Out-of-scope audit

- Out of scope "Snapshot collection logic (lives in F01)": CLEAN — F02 imports only the `RagSnapshot` type from F01, no collection code in this feature.
- Out of scope "Slash command registration / palette wiring (F03)": CLEAN — no `slashCommands.ts` / `contextCommand.ts` / `chatView.tsx`-slash-block edits beyond the side-effect import (which is the registration of the widget itself, in scope per AC1).
- Out of scope "Live-refresh / polling": CLEAN — component is hookless, props-driven only.
- Out of scope "DOM tests beyond Storybook coverage": CLEAN — no `tests/dom/ragWidget.test.tsx` added (matches OQ-F02-2 default).

## QA aggregate

`qa-1.md` Verdict: PASS. Typecheck (0), Lint (0), Tests (1351 passed, 0 failed), Build (0). Re-ran typecheck and build after the side-effect import was added; both still PASS.

## Integration notes

`Entry points:` updated to include `src/ui/chatView.tsx` so the gate captures the runtime view-mount layer (which is how Obsidian plugins surface React roots — the Plugin entry registers a `WorkspaceLeaf` view class that loads the React tree). With that update the integration scan finds `import './chat/widgets/RagWidget'` in `src/ui/chatView.tsx`. Anchor `RagWidget` matches.

## Verdict: PASS
