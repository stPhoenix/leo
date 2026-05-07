# Impl iteration 1 — F22 canvas-slash-commands

## Summary

Three composer slash commands shipped: `/canvas-create <prose>` and `/canvas-edit <prose>` seed prose turns the LLM responds to by calling delegate tools (mirrors `wiki-ingest`/`wiki-lint` precedent — slash command does not invoke tool directly to keep ask routing in the model). `/canvas-status` triggers a snapshot collector (`collectCanvasStatus`) and renders a read-only widget. Snapshot enumerates `CanvasMutex.activeAll()` + `.leo/canvas/runs/*.json` (sorted desc by `lastRunAt`, capped at 20). All three are read-only at the slash layer; the actual write tools they seed already enforce confirmation + plan-mode blocking.

## Files

- `src/agent/canvas/canvasStatus.ts` — `CanvasStatus` + `collectCanvasStatus(deps)` pure async snapshot. Lists sidecars, parses `runId`/`lastRunAt`/`schemaVersion`, skips schemaVersion mismatches, sorts desc, caps via `sidecarLimit` (default 20). `sidecarDirError` populated on `vault.list` throw.
- `src/ui/canvasStatusCommand.ts` — `createCanvasStatusCommand({ collect, render, onError })` + `CanvasStatusCommandHandle { invoke, cancel }` + `CANVAS_STATUS_WIDGET_KIND = 'canvas-status'`. Mirrors `wikiStatusCommand.ts` shape including AbortController-per-invoke.
- `src/ui/chat/widgets/CanvasStatusWidget.tsx` — registered renderer; empty state, error banner, active-runs section, recent-canvases section.
- `src/ui/chat/widgets/CanvasStatusWidget.stories.tsx` — Idle, OneActiveRun, Mixed, Error variants.
- `src/ui/chatView.tsx` — added `collectCanvasStatus?` to deps; instantiated `canvasStatusCommand` when collect fn provided; registered `/canvas-status`, `/canvas-create`, `/canvas-edit` slash commands; `renderCanvasStatusAsWidget` appends widget message.
- `src/main.ts` — wired `collectCanvasStatus({ vault, mutex: this.canvasMutex })` into chatView deps.
- `tests/unit/canvas/canvasStatus.test.ts` — 5 tests: idle/empty, active-run pickup, sorted-desc + cap, schemaVersion-mismatch skip, sidecarLimit respected.
- `tests/unit/canvas/canvasStatusCommand.test.ts` — 3 tests: invoke→render, error path, cancel aborts signal.

## Decisions

- **Slash commands seed prose, not tool calls** — matches wiki-ingest precedent. The LLM picks which tool to call (delegate_canvas_create vs delegate_canvas_content_edit) based on the seeded ask. This keeps the slash layer simple and lets the model pick the right tool for ambiguous inputs.
- **Snapshot is one-shot, not subscribed** — per open-question answer: manual refresh (re-invoke `/canvas-status`) only.
- **Sidecar→canvas pairing is approximate** — slug encodes a SHA-prefix of the original vault path, which isn't reversible. v1 displays the kebab leaf only; pairing with the live canvas path requires a vault-wide scan deferred to a later slice if the user demands it.
- **`/canvas-status` allowed in plan mode** — no tool invocation, pure read; plan-mode allowlist gates tools, not slash commands.
- **`vault.list` is the source of truth, not `vault.exists`** — InMemoryVaultAdapter does not auto-create implicit folders on file write; relying on `exists(dir)` would shortcut to empty. List always works (returns empty when dir is absent under any well-formed adapter).

## Test coverage

8 new tests; widget DOM coverage via Storybook fixtures.

## QA local

Typecheck/lint/test/build all green (288 files / 2694 tests; +2 files +8 tests vs F21).
