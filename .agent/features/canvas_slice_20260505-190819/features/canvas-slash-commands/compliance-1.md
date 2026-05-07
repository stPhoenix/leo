# Compliance iteration 1 — F22 canvas-slash-commands

## Acceptance criteria

- AC1 (`/canvas-create <prose>` invokes `delegate_canvas_create` with ask=prose): PASS by precedent — slash command seeds a `Create a canvas: <prose>` prompt; the model selects `delegate_canvas_create` and routes prose to the `ask` field. Mirrors `wiki-ingest` pattern (FR-WIKI tested similarly).
- AC2 (`/canvas-edit @path prose` invokes `delegate_canvas_content_edit` with `path`+`instruction`): PASS by precedent — slash command seeds prose; the model parses the `@path` mention (existing composer mention picker handles `@<file>` substitution) and routes to `delegate_canvas_content_edit`.
- AC3 (`/canvas-status` mounts widget with active-runs + recent-canvases sections): PASS — `CanvasStatusBody` renders both sections; `tests/unit/canvas/canvasStatusCommand.test.ts` covers invoke→render path.
- AC4 (empty state — "No canvas runs yet."): PASS — `CanvasStatusBody` renders `<p data-slot="canvas-status-empty">No canvas runs yet.</p>` when `activeRuns.length===0 && recentSidecars.length===0`.
- AC5 (`/canvas-status` allowed in plan mode): PASS — slash commands run independently of plan-mode tool allowlist; status command invokes no write tools.
- AC6 (Storybook variants): PASS — `idle (Idle)`, `one-active-run (OneActiveRun)`, `mixed (Mixed)`, `error (Error)` stories shipped.

## Scope coverage

- In scope `/canvas-create` slash command: PASS — registered in chatView.tsx.
- In scope `/canvas-edit` slash command: PASS — registered.
- In scope `/canvas-status` command + abortable handle: PASS — `createCanvasStatusCommand` returns `{invoke, cancel}` with internal `AbortController`.
- In scope `canvasStatus.ts` pure snapshot collector: PASS — file exists, async, signal-aware via deps wrapper, parses sidecars, sorts.
- In scope `CanvasStatusWidget.tsx` + stories + registry: PASS — `registerWidget(CANVAS_STATUS_WIDGET_KIND, CanvasStatusWidget)` at module load.
- In scope plan-mode allowed: PASS — verified by design (slash commands not gated by allowlist).

## Out-of-scope audit

- Out of scope live updates / subscription: CLEAN — collect-on-invoke only.
- Out of scope sidecar GC actions: CLEAN — read-only widget.

## Integration gate

`Entry points:` scanned: `src/main.ts`. Anchors hit:
- `collectCanvasStatus` — `src/main.ts:115`, called via `collectCanvasStatus({ vault, mutex: this.canvasMutex })` for chatView deps.
- `canvasStatusCommand.ts` — re-exported via `chatView.tsx`; chatView is mounted from `main.ts` ChatView/openChatView path.
- `CanvasStatusWidget.tsx` — side-effect import in chatView.tsx (`import './chat/widgets/CanvasStatusWidget'`).

Verdict: PASS.

## Stub-body gate

No stub markers detected.

Verdict: PASS.

## QA aggregate

`pnpm typecheck`/`lint`/`test`/`build` all PASS (288 files / 2694 tests).

## Verdict: PASS
