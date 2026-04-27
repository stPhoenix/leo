# F08 — Inline widget UI + Storybook

## Purpose

Render the external-agent widget as an inline assistant message block in the chat thread. Drives every user-facing affordance from `WidgetViewModel` (F07): refined prompt textarea, adapter picker, timeout/budget inputs, Send/Edit/Cancel buttons, clarifying-question chat, streaming response panel, event log. Collapses to a one-line summary at terminal states. Storybook fixtures cover every phase, mirroring the existing block-component convention.

Implements [`context.md`](../../context.md) FR-EXT-11, FR-EXT-12, FR-EXT-13, FR-EXT-14, FR-EXT-25, FR-EXT-26, FR-EXT-27.

## Scope

**In scope**
- `src/ui/chat/blocks/ExternalAgentWidget.tsx`: top-level component receiving `{ controller: ExternalAgentWidgetController }` (or its store handle). Phase-driven rendering via `useSyncExternalStore` against the F07 store. Subcomponents:
  - `ExternalAgentWidgetPreparing.tsx` — refine transcript + clarifying-question input.
  - `ExternalAgentWidgetReady.tsx` — refined-prompt editable textarea, adapter picker, timeout/budget inputs, Send/Edit/Cancel buttons.
  - `ExternalAgentWidgetRunning.tsx` — adapter label, abort button, response stream panel, collapsible event log, elapsed-time counter.
  - `ExternalAgentWidgetTerminal.tsx` — collapsed one-line summary (status icon + adapter label + folder link + duration), expandable to show recorded refine transcript + final prompt + (if ERROR) error code/message.
- `src/ui/chat/blocks/ExternalAgentWidget.stories.tsx`: stories per phase (`Preparing.Idle`, `Preparing.AwaitingClarification`, `Ready.Default`, `Ready.Editing`, `Running.EarlyStream`, `Running.WithFiles`, `Terminal.Done`, `Terminal.Cancelled`, `Terminal.Error`, `Terminal.Reload`). Uses canned `WidgetViewModel`s — no real subgraph.
- Wiring into `src/chat/types.ts` (new block kind `external_agent_widget` in the union; the persistence side is F12).
- DOM/component test (Vitest + happy-dom + RTL): each phase renders the right primary action; clicking Send dispatches `controller.onSend(...)` with the textarea contents and current picker/timeout values.
- Tailwind styles scoped under `.leo-root` per existing convention; uses Obsidian CSS vars.

**Out of scope**
- Persistence of the block kind in `messageStore` JSON (F12).
- Adapter-list source-of-truth UI (F11 — settings).
- Subgraph + controller logic (F03–F07).

## Acceptance criteria

1. Component renders correctly for every `WidgetViewModel` discriminator (`preparing`, `awaitingClarification`, `ready`, `running`, `done`, `cancelled`, `error`). Each phase verified by a story + an RTL `getByRole`/`findByText` test.
2. **Ready** phase shows: refined-prompt textarea (editable, monospace), adapter picker (lists enabled adapters from controller; disabled adapters not shown — FR-EXT-34), timeout input (number, ms), refine-budget input (number, 1–10), three buttons `Send`, `Edit`, `Cancel`. `Edit` is disabled if textarea content == current refined prompt (no-op guard). Honors FR-EXT-11..14, FR-EXT-27.
3. **Running** phase shows: adapter label, elapsed time (live, 1 Hz tick), `Cancel` button, streaming response panel (auto-scrolls if user is at bottom), collapsible event log, file placeholders for any unwritten file events. Honors FR-EXT-16, FR-EXT-18 (button), FR-EXT-27.
4. **Terminal** phases render a one-line summary by default: status icon (✓ done / ✕ cancelled / ⚠ error), adapter label, folder link (or "no folder" if `folder=null` per F05 OQ-02), duration in human format (e.g. `1m 23s`). Click → expands to refine transcript + final prompt + (ERROR) error block. Honors FR-EXT-26.
5. **Awaiting clarification** phase shows the question prominently, an answer textarea, and a single `Send answer` button that calls `controller.onAnswerClarification(...)`. Honors FR-EXT-08 (UI side).
6. **Reload** terminal variant (an `error` viewmodel with `error.code='reload'`) shows a distinct copy: "Plugin reloaded during this run — request was lost." Honors NFR-EXT-04 surface.
7. Storybook fixtures (`ExternalAgentWidget.stories.tsx`) cover every phase listed in §Scope. Each story renders without errors in the existing Storybook config (`pnpm storybook`); each is referenced from the project Storybook sidebar under "blocks/ExternalAgentWidget". Honors Constraint **C-06** ("don't forget storybooks").
8. Accessibility: every interactive control has an accessible name (`aria-label` or visible text). All buttons reachable by keyboard tab order in stable left-to-right order.
9. No business logic in the component beyond projecting `viewModel` and dispatching to `controller.on*` handlers — verifiable by static lint (component file imports nothing from `src/agent/`, `src/storage/`, `src/providers/`).
10. Renders inline as a chat message block — registered in the chat block renderer the same way `PlanApprovalDialog` is. The widget participates in the existing scroll-anchoring (`scrollAnchoring.ts`).

## Dependencies

- **F07** — `ExternalAgentWidgetController` and `WidgetViewModel`.
- Cross-doc:
  - [`context.md#fr-ext-11`](../../context.md#functional-requirements)
  - [`../widget-controller/feature.md`](../widget-controller/feature.md)
  - Storybook constraint [`context.md#constraints`](../../context.md#constraints) **C-06**.

## Implementation notes

- Block component conventions — see existing block components in [`.agent/standards/project-structure.md`](../../../../standards/project-structure.md) (`src/ui/chat/blocks/*`); model after `DiffView`, `PlanApprovalDialog`, `GroupedToolUses` (each has a `.stories.tsx` sibling).
- React 18 hook order — per [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §React 18.
- `useSyncExternalStore` for the controller subscription — ensures correct streaming updates without re-render loops; pattern in [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §React 18 (stable props).
- Tailwind + Obsidian theme vars — scope under `.leo-root` per [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §Styling.
- Storybook config — see project layout for `.storybook/` setup in [`.agent/standards/project-structure.md`](../../../../standards/project-structure.md); existing stories provide the import-and-fixture pattern.
- Architecture layer — UI layer per [`.agent/architecture/architecture.md`](../../../../architecture/architecture.md) §2; component imports controller via injected prop, never reaches into Agent layer directly.

## Open questions

- **OQ-01-F08** Should the streaming response panel render Markdown live, or render raw text until terminal? Live Markdown can flicker on partial code blocks. **Proposed**: raw monospace until DONE; switch to `MarkdownRenderer` on terminal expand.
- **OQ-02-F08** Folder link target — open folder in OS file explorer (`Electron.shell.openPath`) or open `response.md` inside Obsidian? **Proposed**: open `response.md` via existing `openNote` tool's primitives — keeps user inside Obsidian.
- **OQ-03-F08** Maximum log-event count rendered before truncation. **Proposed**: 200 lines visible, "Show all" link expands; full log retained in terminal-state record (F12).
