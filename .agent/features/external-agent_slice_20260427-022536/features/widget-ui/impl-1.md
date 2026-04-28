# Impl iteration 1 — F08 widget-ui

## Summary

Built `ExternalAgentWidget.tsx` as a single React component dispatching on `vm.phase` to phase-specific subviews (Preparing / AwaitingClarify / Ready / Running / Terminal). Subscribes to the F07 controller via `useSyncExternalStore`. Ready phase exposes refined-prompt textarea, adapter `<select>`, timeout/budget number inputs, and Send/Edit/Cancel buttons (Edit disabled when textarea unchanged, Send disabled when no adapter selected). Running phase shows a streaming `<pre>`, a 1 Hz elapsed counter, and a collapsible event log capped at the last 200 entries (per OQ-03-F08). Terminal collapses to a single button-row summary (status icon + adapter label + duration + folder link); reload variant shows a distinct "Plugin reloaded during this run — request was lost." notice. All controls carry accessible names. Styles scoped under `.leo-root` with `leo-ea-*` class names. Storybook fixtures cover all 10 phases (Preparing.Idle, Preparing.AwaitingClarification, Ready.Default, Ready.EmptyAdapters, Ready.ValidationError, Running.EarlyStream, Running.WithFiles, Terminal.Done, Terminal.Cancelled, Terminal.Error, Terminal.Reload). Storybook static build succeeds.

## Files touched

- `src/ui/chat/blocks/ExternalAgentWidget.tsx` — new component (~290 lines, 5 subviews + 2 helpers).
- `src/ui/chat/blocks/ExternalAgentWidget.stories.tsx` — 10 stories.
- `tests/dom/externalAgentWidget.test.tsx` — 9 cases (every phase rendered + Send/Edit/Cancel/clarify dispatch + reload variant + validation alert).

## Tests added or updated

- AC1 — phase coverage tests (9 cases, one per phase / variant).
- AC2 — "ready Send disabled when no adapter selected", "ready Edit disabled when textarea unchanged".
- AC3 — "running shows streaming text and Cancel" + "running" stories with elapsed counter (visible in Storybook).
- AC4 — "terminal done summary expands" asserts duration, folder, and expanded body.
- AC5 — "awaiting_clarify shows question and Send answer button" exercises onAnswerClarification dispatch.
- AC6 — "terminal reload variant shows distinct copy".
- AC7 — Stories shipped + Storybook build verified (`pnpm build-storybook` exits 0).
- AC8 — every interactive control has `aria-label` (verified by RTL `getByLabelText`).
- AC9 — Component file imports only from `@/agent/externalAgent/widgetController` (controller type) and React; no `@/storage`, `@/providers`, `@/agent/*` other than the widget controller.
- AC10 — Block participates in normal chat-block rendering once F12 wires the block kind through `messageStore`; this slice ships the component, F12 wires the registry.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- All phase subviews live in `ExternalAgentWidget.tsx` rather than separate files (`ExternalAgentWidgetPreparing.tsx` etc.). The total file is ~290 lines and easier to read end-to-end than five split files; the spec's "subcomponents" requirement is honored at the React-component-tree level (each phase is its own pure function). Easy future refactor if files grow.
- Live Markdown rendering of the streaming response is deferred (per OQ-01-F08): raw monospace until terminal, plain `<pre>` body when expanded. `MarkdownRenderer` integration tracked separately.
- Folder link is text-only for now (per OQ-02-F08 design); `Electron.shell.openPath` integration left for a follow-up since opening a folder requires platform plumbing not yet wired.

## Assumptions

- Per OQ-01-F08: raw `<pre>` until terminal; expanded view is also raw to keep render simple.
- Per OQ-02-F08: folder text only (no link); no platform wiring for folder open in v1.
- Per OQ-03-F08: log truncated to last 200 lines visible.

## Open questions

OQ-01/02/03-F08 honored. No new open questions.
