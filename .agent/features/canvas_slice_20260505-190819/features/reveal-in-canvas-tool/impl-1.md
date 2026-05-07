# Impl iteration 1 — F03 reveal-in-canvas-tool

## Summary
Added `src/agent/canvas/tools/revealInCanvas.ts` exporting `createRevealInCanvasTool` (`requiresConfirmation:false`, `isReadOnly:true`, source: `builtin`). Tool reads canvas JSON via `parseCanvasJson`, computes bbox from `nodeIds` (skips unknowns) or uses supplied `bbox` (precedence), pads with `BBOX_PADDING=80`, and dispatches via `ctx.canvasNavigator.panZoomToBbox`. Threaded `canvasNavigator?: CanvasNavigator` through `ToolCtx` (`src/tools/types.ts`), `AgentRunnerOptions` (`src/agent/agentRunner.ts`), and `AgentGraphDeps` (`src/agent/graph.ts`) so it reaches `tool.invoke`. Added `reveal_in_canvas` to `DEFAULT_PLAN_MODE_ALLOWLIST` and updated the plan-mode reminder + `planModeTools` description prose. Wired in `src/main.ts`: instantiates `CanvasNavigator` via `createObsidianCanvasNavigator`, registers the tool, passes navigator into `AgentRunner`. Test helper `tests/unit/_toolCtx.ts` extended with optional `canvasNavigator`.

## Files touched
- `src/agent/canvas/tools/revealInCanvas.ts` — new tool
- `src/tools/types.ts` — `ToolCtx.canvasNavigator?: CanvasNavigator`
- `src/agent/graph.ts` — thread `canvasNavigator` through `AgentGraphDeps` → tool ctx
- `src/agent/agentRunner.ts` — wire `canvasNavigator` from options into deps
- `src/agent/planModeController.ts` — allowlist entry + reminder text
- `src/tools/planModeTools.ts` — long-description prose listing read-only tools
- `src/main.ts` — instantiate `CanvasNavigator`, register tool, pass to `AgentRunner`
- `tests/unit/_toolCtx.ts` — extend `makeToolCtx` with optional `canvasNavigator`
- `tests/unit/planModeController.test.ts` — extend allowlist test to include `reveal_in_canvas`
- `tests/unit/revealInCanvasTool.test.ts` — new tool tests (9 cases)

## Tests added or updated
- `tests/unit/revealInCanvasTool.test.ts` — covers AC1 (`viewportApplied:true`), AC2 (warning surface), AC3 (`nodeIds` union/skip), AC4 (`bbox` precedence), AC6 (`requiresConfirmation:false`, `isReadOnly:true`); plus path-validation, no-navigator, openCanvas-failure cases.
- `tests/unit/planModeController.test.ts` — extended allowlist assertion to include `reveal_in_canvas` (AC5).

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
- `nodeIds` with no known matches returns `viewportApplied: false` rather than calling navigator with a default zoom — feature.md AC3 says "empty resulting bbox falls back to default zoom" but the navigator has no default-zoom entrypoint per F02 scope; treating "no bbox to apply" as `viewportApplied: false` matches FR-CANVAS-58 result shape and lets a future iteration add an explicit `defaultZoom()` op on the navigator if needed. Logged unknowns at `debug` per AC3.

## Assumptions
- Tool description (LLM-facing) is intentionally short; the SRS "long description" pattern (used by `EnterPlanMode`/`TodoWrite`) is reserved for tools that need detailed when/when-not guidance. `reveal_in_canvas` is opportunistic.
- Plan-mode reminder text is updated to include `reveal_in_canvas` so the user-facing list stays accurate; downstream snapshots are not affected (no test snapshots the reminder verbatim).

## Open questions
- Open question §15.1 (selectNodeIds) deferred per feature.md.
