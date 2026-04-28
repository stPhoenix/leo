# F25 — Plan approval dialog · UI

## Layout

The approval is rendered inline in the `InlineDialog` region scaffolded by [F04 chat-sidebar-view](../chat-sidebar-view/feature.md) — it is NEVER an Obsidian native `Modal` per [FR-UI-08](../../context.md#fr-ui-08) / [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns). Four ASCII wireframes follow.

### Wireframe 1 — View state (rendered markdown body + three-button action row)

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|   min-width marker: 280 px
+--------------------------------------------------+
| ...transcript bubbles above (from F05)...        |
+--------------------------------------------------+
|  InlineDialog region (from F04)                  |
| ┌──────────────────────────────────────────────┐ |
| │ [✓] Agent proposes this plan                 │ |   <- header band
| │                                              │ |      role="dialog"
| │ ┌──────────────────────────────────────────┐ │ |      aria-modal="true"
| │ │ # Refactor chat view                     │ │ |      aria-labelledby=title
| │ │                                          │ │ |      aria-describedby=body
| │ │ 1. Split MessageList off ChatView        │ │ |   <- MarkdownRenderer output
| │ │ 2. Extract ComposerInput                 │ │ |      (same path as F05 chat
| │ │ 3. Wire inline confirmation region       │ │ |       assistant bubbles use)
| │ │                                          │ │ |      themes + links + embeds
| │ │ See `[[architecture#3.1]]` for refs.     │ │ |      resolve identically
| │ └──────────────────────────────────────────┘ │ |
| │                                              │ |
| │  [ Approve ]  [ Edit ]  [ Reject ]           │ |   <- action row
| └──────────────────────────────────────────────┘ |      primary → secondary → danger
+--------------------------------------------------+
| ...composer below (from F06)...                  |
+--------------------------------------------------+

dialog anchor : [F04](../chat-sidebar-view/feature.md) InlineDialog region
role / ARIA   : role="dialog" aria-modal="true" aria-live="assertive"
                aria-labelledby → header title element id
                aria-describedby → rendered markdown container id
                one-shot SR announce "Plan approval required" on mount
icon          : [setIcon(iconEl, "check")](../../../../standards/tech-stack.md#platform-apis)
                on Approve, "pencil" on Edit, "x" on Reject
header tint   : neutral (--text-normal / --background-secondary)
button order  : [Approve] → [Edit] → [Reject]
                DOM + Tab order matches visual order
focus         : on mount → primary button `[Approve]`
                focus trap cycles Approve → Edit → Reject → wrap
```

The plan body is rendered through [`MarkdownRenderer.render(app, plan, containerEl, "", component)`](../../../../standards/tech-stack.md#platform-apis) — the same path [F05 chat-message-list-markdown](../chat-message-list-markdown/feature.md) uses for assistant bubbles, so code blocks, links, and embeds resolve identically per [FR-CHAT-06](../../context.md#fr-chat-06) / [FR-UI-09](../../context.md#fr-ui-09). The owning `Component` is passed so `MarkdownRenderer` can detach children on unmount per [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules). Zero colour literals — all colour resolves through Obsidian CSS variables per [Code style → Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian).

### Wireframe 2 — Edit state (textarea replaces rendered body + [Save][Cancel])

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|
+--------------------------------------------------+
|  InlineDialog region (from F04)                  |
| ┌──────────────────────────────────────────────┐ |
| │ [✎] Agent proposes this plan (editing)       │ |   <- header switches icon to
| │                                              │ |      "pencil" on Edit mode
| │ ┌──────────────────────────────────────────┐ │ |
| │ │ # Refactor chat view                     │▌│ |   <- <textarea> seeded with
| │ │                                          │ │ |      current plan string
| │ │ 1. Split MessageList off ChatView        │ │ |      (reuses the F06 composer
| │ │ 2. Extract ComposerInput                 │ │ |       auto-sizing textarea)
| │ │ 3. Wire inline confirmation region       │ │ |      white-space: pre-wrap
| │ │ 4. Add plan approval dialog              │ │ |      resizable: vertical
| │ │_                                         │ │ |      focus moves here on
| │ └──────────────────────────────────────────┘ │ |      edit-entry
| │                                              │ |
| │  [ Save ]  [ Cancel ]                        │ |   <- two-button action row
| └──────────────────────────────────────────────┘ |      Tab cycles Save ↔ Cancel
+--------------------------------------------------+

focus         : on Edit click → <textarea> caret at end
                focus trap now cycles textarea → [Save] → [Cancel] → wrap
Save          : commits edited text into pending outcome,
                sets planWasEdited = true,
                ExitPlanMode.call() writes through
                [PlanStore.writePlan(plan)](../plan-files-todos-store/feature.md)
                BEFORE [F24](../plan-mode-permissions/feature.md) flag flip
Cancel        : reverts to Wireframe 1 view state, no side effects
Esc in edit   : first Esc returns to view state (Cancel),
                second Esc rejects (see State machine)
```

Edit mode reuses the auto-sizing `<textarea>` from [F06 chat-composer-input](../chat-composer-input/feature.md) so vertical growth and focus-ring behave identically; the textarea is seeded with the current plan string on entry per [FR-PLAN-07](../../context.md#fr-plan-07) plan.md §5.7 step 2. `Esc` precedence in edit mode matches the [F06 composer / F07 streaming-stop / F17 confirmation](../chat-composer-input/feature.md) precedence ladder — first Esc cancels edit mode, second Esc rejects.

### Wireframe 3 — Empty-plan variant (Reject-only, no dialog)

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|
+--------------------------------------------------+
|  InlineDialog region (from F04)                  |
| ┌──────────────────────────────────────────────┐ |
| │ [!] Agent proposes this plan                 │ |   <- header retained
| │                                              │ |      (plan was empty /
| │ ┌──────────────────────────────────────────┐ │ |       missing per plan.md
| │ │  (no plan provided)                      │ │ |       §5.8 Case 3)
| │ └──────────────────────────────────────────┘ │ |
| │                                              │ |
| │  [ Reject ]                                  │ |   <- only Reject available
| └──────────────────────────────────────────────┘ |      (no content to approve;
+--------------------------------------------------+      feature.md short-circuits
                                                           WITHOUT mounting dialog —
                                                           Case 3 result returned
                                                           directly per AC 6)
```

Per feature.md AC 6 and plan.md §5.8 Case 3, the empty / missing plan case is short-circuited in `ExitPlanMode.call()` BEFORE the dialog would mount — the tool returns the Case 3 verbatim string (`"User has approved exiting plan mode. You can now proceed."`) directly. This wireframe documents the intent-only contingency visual: if the agent were ever to stream an empty plan that did surface here, the only safe action is Reject. In production the dialog never renders for empty plans per [FR-PLAN-07](../../context.md#fr-plan-07).

### Wireframe 4 — Subagent context variant (no dialog mount — auto-routes Case 2)

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|
+--------------------------------------------------+
| ...subagent transcript above (distinct thread)... |
+--------------------------------------------------+
|  InlineDialog region (from F04): (empty)         |   <- NO dialog mounted per
+--------------------------------------------------+      plan.md §5.8 Case 2 —
| tool · ExitPlanMode                              |      ExitPlanMode.call()
|   ✓ User has approved the plan. There is …      |      short-circuits when
|     nothing else needed from you now. Please     |      ctx.thread.agentId != null
|     respond with "ok"                            |      and returns Case 2 result
+--------------------------------------------------+      directly into the graph
| ...subagent continues ("ok")...                  |
+--------------------------------------------------+

subagent guard: ctx.thread.agentId != null → short-circuit in call()
dialog mounts : NEVER — dialog is not rendered at all in subagent contexts
result        : verbatim Case 2 string returned to the graph via F10
Vitest assert : `Modal.prototype.open` never called AND
                InlineDialog region receives zero mount events
                on subagent ExitPlanMode invocations
```

Subagent context (`ctx.thread.agentId != null`) short-circuits in `ExitPlanMode.call()` — the tool-result is the verbatim Case 2 payload per plan.md §5.8 Case 2; no dialog is ever mounted on the subagent path per feature.md AC 6. The Vitest suite per [NFR-TEST-01](../../context.md#nfr-test-01) asserts the InlineDialog region receives zero mount events on this branch.

## State machine

Two concurrent machines — a dialog lifecycle (view ↔ edit with approve/reject terminals) and a focus-trap gate.

### `PlanApprovalLifecycleMachine` (per request)

```
  +--------+  StreamEvent.plan_approval{plan, isSubagent:false}
  |  idle  | ---------------------------------------------------------> +-----------+
  +--------+                                                            | presented |
      ^                                                                 +-----------+
      |                                                                  |  |  |  |
      |                                                                  |  |  |  | click
      |                                              click Approve       |  |  |  | Edit
      |                                                       +----------+  |  |  +-----+
      |                                                       v             |  |        v
      |                                        +---------------+             |  |  +----------+
      |                                        |   approved    |             |  |  | editing  |
      |                                        +---------------+             |  |  +----------+
      |                                                       |             |  |        |  ^
      |                                                       |  click      |  |  click |  | Esc
      |                                                       |  Reject     |  |  Save  |  | (first)
      |                                                       |  (or Esc)   |  |        v  |
      |                                                       |             |  |  +----------+
      |                                                       |             |  |  |  saving  |
      |                                                       |             |  |  +----------+
      |                                                       |             |  |        |
      |                                                       |             |  |  PlanStore.writePlan
      |                                                       |             v  |    resolves OK
      |                                                       |  +---------------+   |
      |                                                       |  |  rejected     |   |
      |                                                       |  +---------------+   |
      |                                                       |             |        v
      |                                                       |             |  +---------------+
      |                                                       |             |  |   approved    |
      |                                                       |             |  | (edited=true) |
      |                                                       |             |  +---------------+
      |                                                       |             |         |
      |                                                       v             v         v
      |                                                   +---------------------------+
      +---------------------------------------------------|          closed            |
                                                          +---------------------------+
                                                          (dialog unmounts; graph
                                                           resumes with outcome)
```

Transitions:

- `idle → presented` — [F10 AgentRunner](../agent-controller-core/feature.md) emits [`StreamEvent.plan_approval{plan, isSubagent:false, threadId}`](../../../../architecture/architecture.md#4-key-contracts) via the LangGraph [`interrupt()` pattern](../../../../standards/tech-stack.md#agent--tool--skill--mcp-wiring); the `ChatView` mounts the dialog into the `InlineDialog` region; focus-trap activates; `aria-live="assertive"` fires "Plan approval required".
- `presented → approved` — user clicks `[Approve]` or Tabs to it and presses Enter/Space; `resolve({outcome:"approve", planWasEdited:false})` called; NO `PlanStore.writePlan` call (plan already on disk from earlier `plan-file-write` calls in plan mode per [F23](../plan-files-todos-store/feature.md) / feature.md § In scope).
- `presented → editing` — user clicks `[Edit]`; rendered markdown region is replaced by a pre-filled `<textarea>`; focus moves into the textarea; focus-trap now cycles `textarea` → `[Save]` → `[Cancel]`.
- `editing → presented` — user clicks `[Cancel]` (or hits `Esc` once); the dialog returns to view state with NO side effects; the textarea buffer is discarded.
- `editing → saving` — user clicks `[Save]`; buttons disabled while [`PlanStore.writePlan(editedPlan)`](../plan-files-todos-store/feature.md) from [F23](../plan-files-todos-store/feature.md) settles; `planWasEdited = true`.
- `saving → approved(edited=true)` — `PlanStore.writePlan` resolves; `resolve({outcome:"approve", planWasEdited:true})` called; [F24 `PlanModeController`](../plan-mode-permissions/feature.md) flips `mode` from `"plan"` back to `"normal"` AFTER the write completes per feature.md AC 3.
- `presented → rejected` / `editing → rejected` — user clicks `[Reject]` OR presses `Esc` twice (once in editing → first exits edit mode, second rejects); `resolve({outcome:"reject"})` called; a typed `PlanApprovalRejected` tool-error is synthesised and fed back into the graph per [Architecture §7 Error Handling Strategy](../../../../architecture/architecture.md#7-error-handling-strategy); [F24](../plan-mode-permissions/feature.md) stays at `mode === "plan"` per plan.md §5.6; NO `PlanStore.writePlan` call; NO `plan.mode.exit` log event.
- Any terminal transition (`approved` / `approved(edited=true)` / `rejected`) → `closed` — dialog unmounts; `MarkdownRenderer` `Component` is detached via `useEffect` cleanup; focus-trap detaches; resolver reference dropped.
- Forced `presented|editing|saving → rejected` — on [F04 ChatView](../chat-sidebar-view/feature.md).`onClose` / thread switch / plugin unload, any pending dialog is forcibly resolved with `{outcome:"reject"}` per [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) (same escape-hatch [F17 tool-confirmation-flow](../tool-confirmation-flow/feature.md) uses).

### `FocusTrapMachine` (paired)

```
  +-----------+  presented entered          +---------+
  | inactive  | --------------------------> | active  |
  +-----------+                             +---------+
       ^                                         |
       |        closed reached / unmount         |
       +-----------------------------------------+
```

Invariants:

- `active` — while `presented` or `editing` (and transiently `saving`): `keydown` on `Tab` / `Shift-Tab` is intercepted and cycled — in view state across `[Approve]` → `[Edit]` → `[Reject]` → wraps (AC 4 of [feature.md](./feature.md)); in edit state across `<textarea>` → `[Save]` → `[Cancel]` → wraps. `Esc` in view state calls `resolve({outcome:"reject"})`; `Esc` in edit state first cancels edit mode, second `Esc` rejects (AC 5). Clicks outside the dialog are ignored — the user must pick an explicit decision (same invariant as [F17](../tool-confirmation-flow/feature.md)).
- `inactive` — all keydown listeners removed; focus-return to the previously-focused node (or composer fallback from [F06](../chat-composer-input/feature.md)).
- Teardown on `ChatView.onClose` / plugin unload — any pending `presented|editing|saving` is forcibly rejected per [Architecture §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules), and the focus trap transitions `active → inactive`.

Both machines are Vitest-unit-tested finite state machines per [NFR-TEST-01](../../context.md#nfr-test-01) and [Code style → Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw).

## Event flow

### 1. Agent calls `ExitPlanMode(plan)` → dialog mounts

1. Turn loop in [F10 `AgentRunner`](../agent-controller-core/feature.md) receives a `tool_call` for `ExitPlanMode` from the provider stream.
2. `ExitPlanMode.call(ctx, {plan})` from [F24 plan-mode-permissions](../plan-mode-permissions/feature.md) is invoked — first it short-circuits on two guards BEFORE any dialog work:
   - `ctx.thread.agentId != null` → subagent context → return Case 2 verbatim (`"User has approved the plan. There is nothing else needed from you now. Please respond with \"ok\""`) directly into the graph per plan.md §5.8 Case 2; dialog NEVER mounts.
   - `plan` is empty / missing → return Case 3 verbatim (`"User has approved exiting plan mode. You can now proceed."`) directly; dialog NEVER mounts.
3. On main-agent non-empty plan, the graph calls LangGraph [`interrupt({plan, isSubagent:false})`](../../../../standards/tech-stack.md#agent--tool--skill--mcp-wiring) which yields a pending state upstream — the turn loop is paused.
4. The pending state is surfaced to the `ChatView` as [`StreamEvent.plan_approval{plan, isSubagent:false, threadId}`](../../../../architecture/architecture.md#4-key-contracts) per [Architecture §5.3](../../../../architecture/architecture.md#53-chat-turn-with-tool-call--confirmation).
5. `ChatView` mounts the `PlanApprovalDialog` into the `InlineDialog` region from [F04](../chat-sidebar-view/feature.md) — NEVER a native Obsidian `Modal` per [FR-UI-08](../../context.md#fr-ui-08); a Vitest assertion spies on `Modal.prototype.open` to guarantee this per [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns).
6. `MarkdownRenderer.render(app, plan, containerEl, "", component)` from [`@obsidian/MarkdownRenderer`](../../../../standards/tech-stack.md#platform-apis) paints the plan body into the rendered-markdown region; the owning `Component` is tracked for cleanup per [Architecture §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules).
7. [`setIcon(iconEl, "check")`](../../../../standards/tech-stack.md#platform-apis) paints the header glyph.
8. `FocusTrapMachine.inactive → active` — `Tab` / `Shift-Tab` / `Esc` keydown listeners attached via [`Plugin.registerDomEvent`](../../../../standards/tech-stack.md#platform-apis); focus moves to the primary button `[Approve]`; `aria-live="assertive"` region fires a one-shot SR announcement `"Plan approval required"` per [NFR-USE-08](../../context.md#nfr-use-08) / [FR-UI-09](../../context.md#fr-ui-09).
9. Structured log event `plan.approval.request {threadId, isSubagent:false, planLength}` via the [F01 Logger](../plugin-bootstrap-logging/feature.md) — plan body NEVER logged above `debug` per [Code style → Logging](../../../../standards/code-style.md#logging) / [NFR-LOG-04](../../context.md#nfr-log-04).

### 2. User clicks `[Approve]` (view state)

1. `onClick` handler calls `resolve({outcome:"approve", planWasEdited:false})` (the resolver passed via `StreamEvent.plan_approval`).
2. NO call to [`PlanStore.writePlan`](../plan-files-todos-store/feature.md) — the plan is already on disk from earlier `plan-file-write` calls during plan mode (feature.md § In scope; [F23](../plan-files-todos-store/feature.md)).
3. [F24 `PlanModeController`](../plan-mode-permissions/feature.md) flips `mode` from `"plan"` back to `"normal"`; its F24 flag clears; `plan.mode.exit` log fires from F24.
4. `ExitPlanMode.call()` returns the typed "ok" `ToolResult` carrying plan.md §5.8 Case 1 payload `"## Approved Plan:\n<plan>"` (no "(edited by user)" suffix when `planWasEdited:false`) back into the [F10 AgentRunner](../agent-controller-core/feature.md) graph per [Architecture §5.3](../../../../architecture/architecture.md#53-chat-turn-with-tool-call--confirmation).
5. `FocusTrapMachine.active → inactive`; focus returns to the prior element (composer fallback from [F06](../chat-composer-input/feature.md)); dialog unmounts; `MarkdownRenderer` `Component` detaches.
6. Structured log event `plan.approval.approve {threadId, planWasEdited:false}` via [F01 Logger](../plugin-bootstrap-logging/feature.md).

### 3. User clicks `[Edit]` → textarea → `[Save]`

1. `onClick` on `[Edit]` transitions `presented → editing`; the rendered markdown region is torn down (`MarkdownRenderer` `Component` detached) and replaced with a `<textarea>` pre-filled with the current plan string, reusing the auto-sizing textarea from [F06 chat-composer-input](../chat-composer-input/feature.md).
2. Focus moves into the textarea (caret at end); focus-trap cycle now spans `<textarea>` → `[Save]` → `[Cancel]`; header icon switches to `setIcon("pencil")`.
3. User edits the text; buffer lives in React local state — no persistence side effects yet.
4. User clicks `[Save]`: state transitions `editing → saving`; all buttons disabled.
5. Handler awaits [`PlanStore.writePlan(editedPlan)`](../plan-files-todos-store/feature.md) from [F23](../plan-files-todos-store/feature.md) — this call happens BEFORE the [F24](../plan-mode-permissions/feature.md) flag flip per feature.md AC 3 / plan.md §5.7 step 2.
6. On write success: state transitions `saving → approved(edited=true)`; `resolve({outcome:"approve", planWasEdited:true})` called; [F24](../plan-mode-permissions/feature.md) flips `mode` back to `"normal"` AFTER the write has settled; `ExitPlanMode.call()` returns the typed "ok" `ToolResult` with Case 1 header `"## Approved Plan (edited by user):\n<editedPlan>"`.
7. `FocusTrapMachine.active → inactive`; dialog unmounts; focus returns to composer.
8. Structured log event `plan.approval.edit {threadId, planWasEdited:true}` via [F01 Logger](../plugin-bootstrap-logging/feature.md) — edited plan content NEVER logged above `debug` per [Code style → Logging](../../../../standards/code-style.md#logging).
9. `[Cancel]` from `editing` transitions back to `presented` with zero side effects; the buffer is discarded; `MarkdownRenderer` re-renders the original plan; focus-trap cycle reverts to `[Approve]` → `[Edit]` → `[Reject]`.

### 4. User clicks `[Reject]` (or presses `Esc` in view state)

1. `onClick` on `[Reject]` (or `Esc` keydown while `FocusTrapMachine.active` and state is `presented`) calls `resolve({outcome:"reject"})`.
2. NO mutation happens — [F24](../plan-mode-permissions/feature.md) `PlanModeController` stays at `mode === "plan"` per plan.md §5.6; NO `PlanStore.writePlan` call; NO `plan.mode.exit` log event; NO mode-transition attachment queued.
3. `ExitPlanMode.call()` synthesises a typed `PlanApprovalRejected` tool-error per [Architecture §7 Error Handling Strategy](../../../../architecture/architecture.md#7-error-handling-strategy) / [Code style → Error Handling](../../../../standards/code-style.md#error-handling) and returns it as the `ToolResult` back into the [F10 AgentRunner](../agent-controller-core/feature.md) graph.
4. `FocusTrapMachine.active → inactive`; focus returns to the prior element; dialog unmounts; `MarkdownRenderer` `Component` detaches.
5. A tool-error bubble renders via the [F13 error state](../ui-visual-states-notifications/feature.md) — the follow-up assistant turn streams normally (mode stays `"plan"`, so the agent knows to propose a revised plan or ask a question).
6. Structured log event `plan.approval.reject {threadId}` via [F01 Logger](../plugin-bootstrap-logging/feature.md).

### 5. `Esc` precedence — view state vs edit state

- In `presented` (view state): `Esc` resolves with `Reject` immediately — same as clicking `[Reject]` per feature.md AC 5 / [NFR-USE-06](../../context.md#nfr-use-06).
- In `editing` (or transient `saving`) state: FIRST `Esc` cancels edit mode (`editing → presented`) with zero side effects; SECOND `Esc` rejects. This two-step ladder matches the [F06 composer / F07 streaming-stop / F17 confirmation](../chat-composer-input/feature.md) precedence ladder.
- Dialog-level `Esc` binds BEFORE [F07 streaming-stop](../chat-streaming-stop/feature.md) and [F06 composer-blur](../chat-composer-input/feature.md) because the dialog is focus-trapped and captures `keydown` at its own listener registered via [`Plugin.registerDomEvent`](../../../../standards/tech-stack.md#platform-apis) per [FR-UI-09](../../context.md#fr-ui-09).

### 6. Teardown (`ChatView.onClose` / thread switch / plugin unload)

1. Any pending `presented|editing|saving` dialog is forcibly resolved with `{outcome:"reject"}` to avoid a dangling interrupt per [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) — same escape-hatch [F17 tool-confirmation-flow](../tool-confirmation-flow/feature.md) uses.
2. `FocusTrapMachine.active → inactive`; keydown listeners removed via `useEffect` return; [`Plugin.registerDomEvent`](../../../../standards/tech-stack.md#platform-apis) pairings auto-dispose per [Code style → React 18](../../../../standards/code-style.md#react-18) / [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns).
3. `MarkdownRenderer` `Component` is detached so its child renderers tear down per [Architecture §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules).
4. Dialog node unmounts; resolver reference dropped; `AbortSignal` threaded from [F07 chat-streaming-stop](../chat-streaming-stop/feature.md) / [F10](../agent-controller-core/feature.md) aborts the upstream graph when the whole turn is cancelled.
5. No dangling listeners, timers, or DOM nodes remain.

## Component mapping

| UI block | Component / API | Standards reference |
|---|---|---|
| Inline dialog container | React `<div role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}>` mounted into the `InlineDialog` region from [F04 chat-sidebar-view](../chat-sidebar-view/feature.md) — NEVER a native [Obsidian `Modal`](../../../../standards/tech-stack.md#platform-apis) per [FR-UI-08](../../context.md#fr-ui-08) | [Architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views); [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| Focus trap | Shared `useFocusTrap(dialogRef, buttons)` hook (same hook [F17 tool-confirmation-flow](../tool-confirmation-flow/feature.md) uses) — in view state cycles `[Approve]` → `[Edit]` → `[Reject]`; in edit state cycles `<textarea>` → `[Save]` → `[Cancel]`; Esc-semantics differ by sub-state (see State machine) | [Architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views); [Code style → React 18](../../../../standards/code-style.md#react-18) |
| Assertive announcement | `aria-live="assertive"` wrapper on the dialog root — one-shot SR announce `"Plan approval required"` on mount | [UI Layer](../../../../standards/tech-stack.md#ui-layer); [Architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) |
| Header icon (view state) | [`setIcon(iconEl, "check")`](../../../../standards/tech-stack.md#platform-apis) — approve affordance cue | [UI Layer → Icons](../../../../standards/tech-stack.md#ui-layer); [Platform APIs](../../../../standards/tech-stack.md#platform-apis) |
| Header icon (edit state) | [`setIcon(iconEl, "pencil")`](../../../../standards/tech-stack.md#platform-apis) — editing affordance cue | [UI Layer → Icons](../../../../standards/tech-stack.md#ui-layer); [Platform APIs](../../../../standards/tech-stack.md#platform-apis) |
| Reject button icon | [`setIcon(btnEl, "x")`](../../../../standards/tech-stack.md#platform-apis) — destructive affordance cue; danger palette on focus ring | [UI Layer → Icons](../../../../standards/tech-stack.md#ui-layer); [Platform APIs](../../../../standards/tech-stack.md#platform-apis) |
| Header title | `<h2 id={titleId}>Agent proposes this plan</h2>` — verbatim copy; no pluralisation | [Architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) |
| Rendered markdown body | `MarkdownRenderer.render(app, plan, containerEl, "", component)` — same path [F05 chat-message-list-markdown](../chat-message-list-markdown/feature.md) uses for assistant bubbles per [FR-CHAT-06](../../context.md#fr-chat-06); owning `Component` tracked for cleanup | [Platform APIs](../../../../standards/tech-stack.md#platform-apis); [Architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) |
| Edit textarea | `<textarea>` reused from [F06 chat-composer-input](../chat-composer-input/feature.md) — auto-sizing; seeded with current plan string; `white-space: pre-wrap`; no new CM6 instance | [UI Layer](../../../../standards/tech-stack.md#ui-layer); [Architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) |
| Button `[Approve]` | `<button type="button" aria-label="Approve plan" data-action="approve">Approve</button>` — primary accent; first in view-state Tab order; focused on mount | [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| Button `[Edit]` | `<button type="button" aria-label="Edit plan" data-action="edit">Edit</button>` — secondary accent; second in view-state Tab order | [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| Button `[Reject]` | `<button type="button" aria-label="Reject plan" data-action="reject">Reject</button>` — danger accent; third in view-state Tab order; Esc synonym (view state) | [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| Button `[Save]` (edit state) | `<button type="button" aria-label="Save edited plan" data-action="save">Save</button>` — primary accent; commits edited buffer + `planWasEdited=true`; disabled while `PlanStore.writePlan` settles | [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| Button `[Cancel]` (edit state) | `<button type="button" aria-label="Cancel edit" data-action="cancel">Cancel</button>` — secondary accent; reverts to view state without side effects | [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| Button order (view state) | DOM + Tab order `Approve` → `Edit` → `Reject` — never reordered between mounts (muscle-memory invariant; AC 4 of [feature.md](./feature.md)) | [Architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) |
| Dialog tint | Neutral: `var(--text-normal)` + `var(--background-secondary)` fill; focus ring `var(--interactive-accent)` — resolved via Obsidian CSS vars; zero colour literals | [UI Layer → Styling](../../../../standards/tech-stack.md#ui-layer); [Code style → Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) |
| Focus ring | `:focus-visible { box-shadow: 0 0 0 2px var(--interactive-accent); outline: none; }` on each button / textarea — zero colour literals per [FR-UI-03](../../context.md#fr-ui-03) | [UI Layer → Styling](../../../../standards/tech-stack.md#ui-layer); [Code style → Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) |
| `data-visual-state` attr | `"plan-approval-pending"` painted on the bubble root in view / edit / saving; dropped on close — consumed by [F13 VisualStateMachine](../ui-visual-states-notifications/feature.md) | [Architecture §4 Key Contracts](../../../../architecture/architecture.md#4-key-contracts) |
| Edit-save persistence | [`PlanStore.writePlan(editedPlan)`](../plan-files-todos-store/feature.md) from [F23](../plan-files-todos-store/feature.md) — called BEFORE the [F24](../plan-mode-permissions/feature.md) flag flip per feature.md AC 3 / plan.md §5.7 step 2 | [Architecture §6 State Ownership](../../../../architecture/architecture.md#6-state-ownership) |
| Approve tool-result | `"## Approved Plan:\n<plan>"` (or `"## Approved Plan (edited by user):\n<plan>"` iff `planWasEdited`) — plan.md §5.8 Case 1 | [Architecture §4 Key Contracts](../../../../architecture/architecture.md#4-key-contracts) |
| Reject → tool-error | Typed `PlanApprovalRejected` tool-error synthesised and fed back into the LangGraph turn loop; [F24](../plan-mode-permissions/feature.md) stays at `mode === "plan"` | [Architecture §7 Error Handling Strategy](../../../../architecture/architecture.md#7-error-handling-strategy); [Code style → Error Handling](../../../../standards/code-style.md#error-handling); [Code style → LangGraph / Agent Layer](../../../../standards/code-style.md#langgraph--agent-layer) |
| Subagent short-circuit | `ctx.thread.agentId != null` in `ExitPlanMode.call()` → return Case 2 verbatim; dialog NEVER mounts (Vitest asserts zero mount events on this branch) | [Architecture §4 Key Contracts](../../../../architecture/architecture.md#4-key-contracts); [Architecture §5.3](../../../../architecture/architecture.md#53-chat-turn-with-tool-call--confirmation) |
| Empty-plan short-circuit | Empty / missing `plan` in `ExitPlanMode.call()` → return Case 3 verbatim; dialog NEVER mounts | [Architecture §4 Key Contracts](../../../../architecture/architecture.md#4-key-contracts); [Architecture §5.3](../../../../architecture/architecture.md#53-chat-turn-with-tool-call--confirmation) |
| `interrupt()` wiring | LangGraph [`interrupt()`](../../../../standards/tech-stack.md#agent--tool--skill--mcp-wiring) pauses the graph before the dialog mounts and resumes on `resolve({outcome, planWasEdited?})` — no ad-hoc event bus; same mechanism [F17](../tool-confirmation-flow/feature.md) uses | [Architecture §5.3](../../../../architecture/architecture.md#53-chat-turn-with-tool-call--confirmation); [Agent / Tool / Skill / MCP Wiring](../../../../standards/tech-stack.md#agent--tool--skill--mcp-wiring) |
| Keyboard reachability | Every action is a real `<button>` in DOM order; Tab / Shift-Tab cycles inside the trap; Enter / Space activates; Esc=Reject (view) or Esc=exit-edit (edit); textarea accepts Enter for newline per [F06](../chat-composer-input/feature.md) | [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| Esc precedence | Dialog Esc binds BEFORE [F07 stop-stream Esc](../chat-streaming-stop/feature.md) and [F06 composer-blur Esc](../chat-composer-input/feature.md) while the dialog is mounted — per [NFR-USE-06](../../context.md#nfr-use-06) / [FR-UI-09](../../context.md#fr-ui-09); edit state requires two Escs to reject per feature.md AC 5 | [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| Reduced-motion handling | `@media (prefers-reduced-motion: reduce)` drops any mount fade and textarea expand-animation; state machines and focus trap unchanged per [Code style → Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) | [Code style → Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) |
| Structured logging | `plan.approval.request` / `plan.approval.approve` / `plan.approval.edit` / `plan.approval.reject` via the [F01 Logger](../plugin-bootstrap-logging/feature.md) with `{threadId, isSubagent, planLength, planWasEdited}`; plan body + edited-plan body NEVER logged above `debug` per [NFR-LOG-04](../../context.md#nfr-log-04) / [Code style → Logging](../../../../standards/code-style.md#logging) | [Code style → Logging](../../../../standards/code-style.md#logging) |
| React mount / unmount symmetry | `useEffect` return detaches keydown listeners + focus trap + `MarkdownRenderer` `Component`; [`Plugin.registerDomEvent`](../../../../standards/tech-stack.md#platform-apis) pairings tracked on the owning Component; pending dialog forcibly rejected on teardown | [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules); [Code style → React 18](../../../../standards/code-style.md#react-18) |
| Unit tests (no-native-Modal, pause-on-ExitPlanMode, Approve→Case 1 no write, Edit+Save→Case 1 (edited by user)+writePlan before F24 flip, Cancel→no side effects, Reject→PlanApprovalRejected+F24 stays plan, subagent→Case 2 no mount, empty→Case 3 no mount, focus-trap view + edit cycles, Esc=Reject view / Esc=exit-edit edit, onClose force-reject) | Vitest + jsdom per [NFR-TEST-01](../../context.md#nfr-test-01) | [Testing](../../../../standards/tech-stack.md#testing); [Code style → Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw) |

Accessibility invariants ([Architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views)):

- `role="dialog"` + `aria-modal="true"` + `aria-live="assertive"` on mount; one-shot SR announcement `"Plan approval required"` per [NFR-USE-08](../../context.md#nfr-use-08) / [NFR-USE-07](../../context.md#nfr-use-07).
- Focus moves to `[Approve]` on mount (or to the `<textarea>` on entering edit mode); focus trap cycles across the three buttons in order `Approve` → `Edit` → `Reject` in view state and `<textarea>` → `Save` → `Cancel` in edit state; focus returns to the previously-focused node on resolve.
- `Esc` is synonymous with `Reject` in view state; in edit state first `Esc` cancels edit, second `Esc` rejects ([NFR-USE-06](../../context.md#nfr-use-06); AC 5 of [feature.md](./feature.md)).
- Keyboard-only operable: every action reachable by Tab / Shift-Tab / Enter / Space / Esc — no pointer required.
- Status never carried by colour alone: icon family (`check`/`pencil`/`x`), header copy ("Agent proposes this plan" / "(editing)"), and button labels convey state.
- `prefers-reduced-motion: reduce` suppresses mount/unmount fade and textarea expand animation; state machines and focus trap fire identically.
- Zero colour literals — a style audit asserts only Obsidian CSS variables are used in the `PlanApprovalDialog` styles ([Code style → Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)).
- Never a native Obsidian `Modal` on this path — a Vitest assertion verifies the `Modal` constructor is never invoked when `ExitPlanMode` is reached on the main-agent non-empty-plan path per [FR-UI-08](../../context.md#fr-ui-08); AC 1 of [feature.md](./feature.md).

## Back-link

[← feature.md](./feature.md)
