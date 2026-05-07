# F22 · canvas-slash-commands — `/canvas-create`, `/canvas-edit`, `/canvas-status`

## Purpose

Register three composer slash commands. `/canvas-create` and `/canvas-edit` invoke their delegate tools with default args and route the user's prose into the `ask` / `instruction` fields. `/canvas-status` is read-only — opens an inline status widget showing active runs (path + phase + runId), recent canvases with sidecars, last-run timestamps. Mirrors `/wiki` and `/rag` slash-command precedents.

Covers [FR-CANVAS-63](../../context.md#functional-requirements).

## Scope

**In scope**

- `/canvas-create` slash command in `src/ui/chat/slashCommands.ts`: takes prose, fills `delegate_canvas_create.input.ask`, no other args.
- `/canvas-edit` slash command: takes prose + optional `path` (mention-based file picker), fills `delegate_canvas_content_edit.input.{ path, instruction }`.
- `/canvas-status` command + abortable handle (mirrors `contextCommand.ts` / `ragCommand.ts` / `wikiStatusCommand.ts`).
- `src/agent/canvas/canvasStatus.ts` — pure status snapshot collector: enumerates `CanvasMutex.activeAll()`, walks `.leo/canvas/runs/` to list recent sidecars (sorted by `lastRunAt` desc, capped at 20), pairs each sidecar slug with its canvas vault path.
- `src/ui/chat/widgets/CanvasStatusWidget.tsx` + `CanvasStatusWidget.stories.tsx` — read-only widget rendering the snapshot. Registered in `src/ui/chat/widgets/registry.ts`.
- `/canvas-status` widget allowed in plan mode (read-only).

**Out of scope**

- Active-run subscription/live updates — v1 is snapshot-on-open.
- Sidecar GC actions — out of v1.

## Acceptance criteria

1. `/canvas-create build me a graph of meetings` → invokes `delegate_canvas_create` with `ask: 'build me a graph of meetings'` — traces to FR-CANVAS-63.
2. `/canvas-edit @people-canvas.canvas add cross-attendees` → invokes `delegate_canvas_content_edit` with `path: 'people-canvas.canvas'`, `instruction: 'add cross-attendees'` — traces to FR-CANVAS-63.
3. `/canvas-status` → snapshot widget mounts; renders active-runs section + recent-canvases section; refresh button re-collects snapshot — traces to FR-CANVAS-63.
4. Empty state: no active runs + no sidecars → widget renders "No canvas runs yet."
5. `/canvas-status` allowed in plan mode (read-only test).
6. Storybook variants: `idle (no runs, no sidecars)`, `one-active-run`, `mixed (running + recent sidecars)`, `error (sidecar dir unreadable)`.

## Dependencies

- [../delegate-canvas-create/feature.md](../delegate-canvas-create/feature.md), [../delegate-canvas-content-edit/feature.md](../delegate-canvas-content-edit/feature.md), [../delegate-canvas-layout-edit/feature.md](../delegate-canvas-layout-edit/feature.md).
- [../canvas-mutex/feature.md](../canvas-mutex/feature.md) — `activeAll()`.
- [../canvas-sidecar/feature.md](../canvas-sidecar/feature.md) — sidecar enumeration helper.
- [../canvas-widget-terminal/feature.md](../canvas-widget-terminal/feature.md) — visual style consistency for status block.
- Requirements traced: [../../context.md#functional-requirements](../../context.md#functional-requirements) FR-CANVAS-63.

## Implementation notes

- [../../../../architecture/architecture.md#3-modules](../../../../architecture/architecture.md#3-modules) — UI widget registration mirrors existing `wikiStatus`/`rag` pattern.
- [../../../../standards/code-style.md#react-18](../../../../standards/code-style.md#react-18) — function components, stable keys, cleanup.
- [../../../../standards/code-style.md#styling-tailwind--obsidian](../../../../standards/code-style.md#styling-tailwind--obsidian) — Obsidian CSS vars for theme alignment.
- [../../../../standards/tech-stack.md#ui-layer](../../../../standards/tech-stack.md#ui-layer) — Lucide icons.

## Open questions

- Should `/canvas-status` auto-refresh on a short interval while active runs exist? No — manual refresh button only; matches `/wiki` precedent.
- Should `/canvas-edit` auto-suggest only canvases that have a sidecar (i.e., editable)? Yes — file picker filters to `*.canvas` with present sidecar.
