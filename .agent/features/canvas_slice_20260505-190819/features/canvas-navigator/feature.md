# F02 · canvas-navigator — Obsidian canvas-view navigator adapter

## Purpose

Wrap the undocumented Obsidian internal canvas-view API in a thin, feature-detected adapter at `src/editor/canvasNavigator.ts` so reveal-style operations (open + pan + zoom-to-bbox) can be invoked without leaking platform shape into the rest of the canvas feature. On API-shape mismatch with the running Obsidian build, the adapter falls back to plain `WorkspaceLeaf.openFile` and surfaces a structured warning. Mirrors the `WorkspaceNavigator` pattern.

Covers [FR-CANVAS-55](../../context.md#functional-requirements), [FR-CANVAS-57](../../context.md#functional-requirements).

## Scope

**In scope**

- `CanvasNavigator` interface + Obsidian-backed implementation at `src/editor/canvasNavigator.ts`.
- `openCanvas(path) → leaf` — opens or focuses an existing leaf showing the canvas file via `WorkspaceLeaf.openFile`.
- `panZoomToBbox(leaf, bbox, padding) → boolean` — casts the leaf view to the internal canvas API; returns `true` on success, `false` on shape-mismatch.
- Runtime feature detection (probe expected method/property names; cache result per session).
- Structured `CanvasNavigatorWarning` union: `reveal_unsupported_in_this_obsidian_version`.

**Out of scope**

- Selection state (`selectNodeIds`) — open question §15.1, deferred.
- Bbox computation from `nodeIds` — F03 (the tool computes bbox from parsed JSON; navigator only consumes a bbox).
- Tool registration — F03.

## Acceptance criteria

1. `openCanvas('a/b.canvas')` opens the canvas in a leaf and resolves to a `WorkspaceLeaf` whose `view.getViewType()` is the canvas type — traces to FR-CANVAS-55.
2. `panZoomToBbox(leaf, { x, y, w, h }, 80)` mutates viewport such that the bbox is fully framed when the internal API is present — traces to FR-CANVAS-55, FR-CANVAS-56.
3. With a stub view that lacks the expected pan/zoom shape, the adapter returns `false` (does not throw) and tests can assert the warning surfaces — traces to FR-CANVAS-57.
4. Feature-detection probe runs once per leaf and never throws — traces to FR-CANVAS-57.
5. DOM test exercises both happy path and shape-mismatch fallback — traces to FR-CANVAS-57.

## Dependencies

- [../canvas-json/feature.md](../canvas-json/feature.md) — bbox shape comes from canvas JSON; helper functions for path validation.
- Forward consumers: [../reveal-in-canvas-tool/feature.md](../reveal-in-canvas-tool/feature.md), [../canvas-widget-live/feature.md](../canvas-widget-live/feature.md) (Open preview button), [../canvas-widget-terminal/feature.md](../canvas-widget-terminal/feature.md) (Open canvas button).
- Requirements traced: [../../context.md#functional-requirements](../../context.md#functional-requirements) FR-CANVAS-55, FR-CANVAS-57.

## Implementation notes

- [../../../../architecture/architecture.md#3-modules](../../../../architecture/architecture.md#3-modules) — `editor/` module layer hosts platform-adjacent adapters; mirror existing `editor/workspaceNavigator.ts`.
- [../../../../architecture/architecture.md#7-error-handling-strategy](../../../../architecture/architecture.md#7-error-handling-strategy) — adapter contract: catch platform errors, surface typed result; never throw across the boundary.
- [../../../../standards/code-style.md#obsidian-plugin-patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) — `MetadataCache` first, async-by-default, no synchronous FS in hot path.
- [../../../../standards/best-practices.md#operational-excellence](../../../../standards/best-practices.md#operational-excellence) — instrument feature-detection result at `debug` level in `canvas.reveal.*` namespace.

## Open questions

- Does Obsidian ≥ 1.5.0 expose stable `requestFrame`/`viewport.tx,ty,scale` properties or do we need to bind to the canvas-plugin internal types? Pin against the running build via runtime probes; record observed shape in the feature-detection log.
