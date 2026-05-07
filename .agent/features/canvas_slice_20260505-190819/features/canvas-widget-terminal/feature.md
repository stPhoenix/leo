# F18 · canvas-widget-terminal — Terminal snapshot + terminal block

## Purpose

Persist a Zod-typed terminal snapshot per canvas run so a thread-reopen (or a plugin reload between runs) re-renders a collapsed summary block with the canvas link, insights, error if any, and failed-source list. Live blocks active at reload rehydrate to `error.code = 'reload'` per NFR-CANVAS-02. Mirrors `WikiTerminalBlock` / `wiki/terminalSnapshot.ts`.

Covers [FR-CANVAS-45](../../context.md#functional-requirements), [FR-CANVAS-61](../../context.md#functional-requirements), [FR-CANVAS-62](../../context.md#functional-requirements), [NFR-CANVAS-02](../../context.md#non-functional-requirements).

## Scope

**In scope**

- `src/agent/canvas/widget/terminalSnapshot.ts` — `CanvasTerminalSnapshot` Zod schema (`schemaVersion: 1`, `runId`, `op`, `targetPath`, `outcome: 'done' | 'cancelled' | 'error'`, `phaseAtTerminal`, `insights?`, `error?`, `failedSources?`, `durationMs`, `createdAt`).
- `buildCanvasTerminalSnapshot(state, outcome) → CanvasTerminalSnapshot` builder (filters secret fields per `CANVAS_SENSITIVE_FIELD_KEYS`).
- `tryParseCanvasTerminalSnapshot(raw) → CanvasTerminalSnapshot | null` for rehydration.
- `src/ui/chat/blocks/CanvasTerminalBlock.tsx` — registered renderer under `CANVAS_TERMINAL_KIND`. Collapsed one-line summary expandable to: insights bullet list, target-path link, **Open canvas** button (calls `reveal_in_canvas`), error message if any, failed-source list if any.
- Reload rehydration: subgraph driver writes the terminal snapshot via `persistSnapshot` callback before tool resolves; if a live block is encountered post-reload without a controller in registry, renderer flips to `error.code='reload'`.
- `CanvasTerminalBlock.stories.tsx` Storybook fixtures.

**Out of scope**

- Live block — F17.
- Tool-result shaping — F19/F20/F21 (they construct snapshot from terminal state).

## Acceptance criteria

1. `buildCanvasTerminalSnapshot` produces a Zod-valid snapshot for DONE / CANCELLED / ERROR outcomes — traces to FR-CANVAS-61.
2. `CanvasTerminalBlock` collapsed view shows `<icon> <op> · <targetPath> · <node-count> nodes · <edge-count> edges`; expand reveals insights + failed-source list — traces to FR-CANVAS-45, FR-CANVAS-61.
3. **Open canvas** button calls `reveal_in_canvas({ path: targetPath })` — traces to FR-CANVAS-61.
4. Snapshot strips fields listed in `CANVAS_SENSITIVE_FIELD_KEYS` (e.g., `rawSource`, `extractorOutput`) — traces to NFR-CANVAS-03.
5. Plugin reload rehydration: a live block whose `runId` is no longer in `canvasLiveControllerRegistry` renders an `error.code='reload'` collapsed block — traces to FR-CANVAS-62, NFR-CANVAS-02.
6. Schema-version mismatch on rehydration → snapshot ignored, generic "snapshot incompatible" terminal placeholder rendered (no crash).
7. Storybook variants: `done-with-insights`, `done-empty-graph`, `cancelled`, `error-reduce-invalid`, `error-reload`, `partial-with-failed-sources`.

## Dependencies

- [../canvas-widget-live/feature.md](../canvas-widget-live/feature.md) — registry + controller types reused (`CANVAS_LIVE_KIND` already defined).
- [../canvas-reducer/feature.md](../canvas-reducer/feature.md) — `Insights` shape.
- [../canvas-subgraph/feature.md](../canvas-subgraph/feature.md) — `persistSnapshot` callback wiring.
- [../reveal-in-canvas-tool/feature.md](../reveal-in-canvas-tool/feature.md) — Open-canvas button dispatch.
- Requirements traced: [../../context.md#functional-requirements](../../context.md#functional-requirements) FR-CANVAS-45, FR-CANVAS-61, FR-CANVAS-62; [../../context.md#non-functional-requirements](../../context.md#non-functional-requirements) NFR-CANVAS-02.

## Implementation notes

- [../../../../architecture/architecture.md#6-state-ownership](../../../../architecture/architecture.md#6-state-ownership) — terminal snapshots are persisted state outside the subgraph.
- [../../../../architecture/architecture.md#3-modules](../../../../architecture/architecture.md#3-modules) — block renderer registration pattern.
- [../../../../standards/code-style.md#react-18](../../../../standards/code-style.md#react-18) — collapse animation via grid-template-rows trick (precedent in `styles.css`).
- [../../../../standards/code-style.md#zod--tool-schemas](../../../../standards/code-style.md#zod--tool-schemas) — Zod parse on rehydration boundary.

## Open questions

- Should the terminal snapshot embed a thumbnail of the canvas (data URL)? No — out of scope, would break NFR-CANVAS-04 bundle/per-message size budget.
- Should collapse default to expanded for ERROR outcomes? Yes — error needs visibility (mirror wiki terminal block).
