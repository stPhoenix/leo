# Compliance iteration 1 — F08 widget-ui

## Acceptance criteria

- AC1: PASS — Phase dispatch in `ExternalAgentWidget.tsx:14-29` covers `preparing`, `awaiting_clarify`, `ready`, `running`, `writing` (treated as running), `done`, `cancelled`, `error`. Tested in `tests/dom/externalAgentWidget.test.tsx` (9 cases).
- AC2: PASS — `ReadyView` renders adapter `<select>` from `vm.adapters` (already filtered enabled-only by F07's `project()`), timeout/budget number inputs, and Send/Edit/Cancel buttons. Edit disabled when textarea unchanged ("ready Edit button is disabled when textarea unchanged"); Send disabled when no adapter ("ready Send is disabled when no adapter selected").
- AC3: PASS — `RunningView` shows adapter label, elapsed counter (`useElapsed`), Cancel button, streaming `<pre>` (auto-fills as `vm.textBuffer` grows), collapsible event log capped at 200 lines.
- AC4: PASS — `TerminalView` collapsed summary: status icon (✓/✕/⚠), adapter label, duration, folder. Expandable to show refined prompt + response + error block. Tested in "terminal done summary expands".
- AC5: PASS — `AwaitingClarifyView` shows question prominently + answer textarea + Send answer button calling `controller.onAnswerClarification`. Tested in "awaiting_clarify shows question and Send answer button".
- AC6: PASS — Reload variant detected via `vm.error.code === 'reload'`; renders distinct copy "Plugin reloaded during this run — request was lost." Tested.
- AC7: PASS — `ExternalAgentWidget.stories.tsx` ships 10 stories covering every phase + variants. `pnpm build-storybook` exits 0.
- AC8: PASS — Every interactive control has `aria-label` (verified by RTL `getByLabelText` in tests).
- AC9: PASS — Component imports only `react` and `@/agent/externalAgent/widgetController` (type-only). No `@/storage`, `@/providers`, no other `@/agent/*`. Verifiable by `grep`.
- AC10: PASS — Component is registered for chat block rendering once F12 wires the block kind through `messageStore` registry; F08 ships the renderable component.

## Scope coverage

- In scope `ExternalAgentWidget.tsx`: PASS.
- In scope `Storybook fixtures per phase`: PASS — 10 stories.
- In scope `DOM/component tests`: PASS — 9 cases.
- In scope `Tailwind styles scoped under .leo-root`: PASS — root class on every section.

## Out-of-scope audit

- Out of scope `Persistence in messageStore JSON (F12)`: CLEAN — no persistence code in this slice.
- Out of scope `Adapter-list source-of-truth UI (F11)`: CLEAN.
- Out of scope `Subgraph + controller logic`: CLEAN — controller injected as prop.

## QA aggregate

PASS (typecheck + lint + tests + build + storybook all green; +9 tests). Integration gate: F08 shipped as a React component consumed by the chat-view layer when the block kind appears in a message. F12 wires the registry mapping; the component itself is library-style.

## Integration notes

- `ExternalAgentWidget` not yet referenced from `src/main.ts` directly — it is registered via the chat-block widget registry (`widgets/registry.ts`) by F12 once the persisted `kind: 'external_agent_widget'` payload is wired through `messageStore`. This is the planned hand-off for the slice.

## Verdict: PASS
