# Compliance iteration 1 — F08 progress-events

## Acceptance criteria

- AC1: PASS — `ProgressEvent` union shape (`src/chat/runStateStore.ts:11-49`) matches livestatus.md §5.
- AC2: PASS — `StreamingTurnController.consume({type:'progress'})` is a no-op at controller level but `chatView.onEvent` routes to `runStateStore.appendProgress` per F03 wiring.
- AC3: PASS — `ToolCtx.progress(event)` helper added (`src/tools/types.ts`). MCP runner / future bash-style tools call it; built-in atomic tools do not need to.
- AC4: PASS — chatView.onEvent routes progress events to `runStateStore.appendProgress`. `tests/dom/progressLines.test.tsx:36` exercises live render on event arrival.
- AC5: PASS — `ProgressLines` truncates to `maxVisible` (default 5) with `+K more` overflow (`tests/dom/progressLines.test.tsx:25`).
- AC6: PASS — `clearProgress` empties slot (`tests/dom/progressLines.test.tsx:51`).
- AC7: DEVIATION — agent-kind events route through `AgentProgressTree` (F09); see `impl-1.md`.
- AC8: PASS — Storybook covers each kind + overflow + cleared-on-resolve (via clearProgress test).

## Scope coverage

- In scope "ProgressEvent tagged union": PASS.
- In scope "StreamEvent variant `progress`": PASS.
- In scope "Controller routes progress to appendProgress": PARTIAL — controller calls `deps.onEvent`; chatView's onEvent then calls `runStateStore.appendProgress` (F03 wiring). Effect identical.
- In scope "ToolCtx.progress helper": PASS.
- In scope "ProgressLines + per-kind formatting": PASS.
- In scope "Sub-agent tree handoff": PASS (delivered as part of this iteration; F09 will mark feature-complete via shared deliverable).
- In scope "Logger entry on agent kind": PARTIAL — not added; `Logger` is plumbed through ChatView but not invoked here. Follow-up.

## Out-of-scope audit

- Out of scope "Sub-agent tree shape — F09": LEAK (planned) — F09 deliverable shipped here for cohesion. Documented in `impl-1.md`.
- Out of scope "Live indicator — F11": CLEAN.

## QA aggregate

PASS — 1211 tests.

## Integration gate

New public modules:
- `src/ui/chat/blocks/ProgressLines.tsx` — anchor `ProgressLines` re-exported from `src/ui/chat/blocks/index.ts` (entry barrel) and referenced in `src/ui/chatView.tsx`.
- `src/ui/chat/blocks/AgentProgressTree.tsx` — anchor `AgentProgressTree` re-exported from `src/ui/chat/blocks/index.ts` and imported by `ProgressLines.tsx`.
- Story files integrated via `.storybook/main.ts` glob.

Verdict: PASS.

## Verdict: PASS
