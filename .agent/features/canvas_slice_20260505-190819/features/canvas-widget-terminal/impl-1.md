# Impl iteration 1 — F18 canvas-widget-terminal

## Summary

Persisted Zod-typed terminal snapshot for canvas runs. `CanvasTerminalSnapshot` covers `done | cancelled | error` outcomes; rehydration parses with `safeParse` so `schemaVersion` mismatch returns null and triggers placeholder rendering. `CanvasTerminalBlock` registers under `CANVAS_TERMINAL_KIND='canvas_terminal'` — collapsed one-line summary, expand reveals insights, target-path link, **Open canvas** button, error, failed-source list. Error outcomes default to expanded.

## Files

- `src/agent/canvas/widget/terminalSnapshot.ts` — `CanvasTerminalSnapshotSchema` (`schemaVersion: literal(1)`), `buildCanvasTerminalSnapshot({ view, nodeCount?, edgeCount?, now? })`, `tryParseCanvasTerminalSnapshot(raw) → snapshot | null`, `CANVAS_TERMINAL_KIND`. Reuses `Insights` schema from `schemas.ts`.
- `src/ui/chat/blocks/CanvasTerminalBlock.tsx` — invalid-snapshot placeholder, expandable summary, **Open canvas** button via module-level `actions` registry (`setCanvasTerminalActions({ onOpenCanvas })` for app wiring at startup).
- `src/ui/chat/blocks/CanvasTerminalBlock.stories.tsx` — fixtures: `DoneWithInsights`, `DoneEmptyGraph`, `Cancelled`, `ErrorReduceInvalid`, `ErrorReload`, `PartialWithFailedSources`, `InvalidSnapshot`.
- `tests/unit/canvas/terminalSnapshot.test.ts` — 6 tests: build done/cancelled/error, parse valid, parse schemaVersion mismatch null, parse unrelated null.

## Decisions

- **Module-level `actions` registry for Open-canvas button** — terminal blocks are static `WidgetComponent` (no controller), so click handler dispatch must go through a side-channel. App wires `setCanvasTerminalActions({ onOpenCanvas: (path) => revealInCanvasTool.invoke({ path, nodeIds: [] }) })` at plugin load. Mirrors how WikiTerminalBlock omits this (no equivalent action) — canvas needs it per AC #3.
- **Error outcomes default expanded** — per open-question answer in feature.md.
- **`failedSources` is plain `{ref,code,message}[]`** — schema same as `CanvasFailedSource` in state.ts; deliberately avoiding extra fields to keep snapshot small.

## Test coverage

6 tests; component DOM coverage via Storybook fixtures.

## QA local

Typecheck/lint/test/build all green (280 files / 2650 tests).
