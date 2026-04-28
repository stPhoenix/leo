# F17 — Tool confirmation flow · UI

## Layout

The confirmation is rendered inline in the `InlineConfirmation` region scaffolded by [F04 chat-sidebar-view](../chat-sidebar-view/feature.md) — it is NEVER an Obsidian native `Modal` ([FR-UI-08](../../context.md#fr-ui-08); [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns)). Four ASCII wireframes follow.

### Wireframe 1 — Inline confirmation dialog in chat (generic / read tool)

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|   min-width marker: 280 px
+--------------------------------------------------+
| ...transcript bubbles above (from F05)...        |
+--------------------------------------------------+
|  InlineConfirmation region (from F04)            |
| ┌──────────────────────────────────────────────┐ |
| │ [📖] read_note                               │ |   <- header band
| │      Read a note from the vault              │ |      role="dialog"
| │                                              │ |      aria-modal="true"
| │ ┌──────────────────────────────────────────┐ │ |      aria-labelledby=title
| │ │ {                                        │ │ |      aria-describedby=args
| │ │   "path": "Notes/Inbox/Weekly.md"        │ │ |   <- pre block
| │ │ }                                        │ │ |      monospace
| │ └──────────────────────────────────────────┘ │ |      white-space: pre
| │                                              │ |      pretty-printed JSON
| │  [ Allow once ] [ Allow for thread ] [Deny] │ |   <- action row
| └──────────────────────────────────────────────┘ |      primary → secondary → danger
+--------------------------------------------------+
| ...composer below (from F06)...                  |
+--------------------------------------------------+

dialog anchor: [F04](../chat-sidebar-view/feature.md) InlineConfirmation region
role/ARIA   : role="dialog" aria-modal="true" aria-live="assertive"
              aria-labelledby → header title element id
              aria-describedby → args <pre> element id
icon        : [setIcon(iconEl, iconFor("read_note"))](../../../../standards/tech-stack.md#platform-apis)
              via [F13 iconFor registry](../ui-visual-states-notifications/feature.md)
              ("book-open" for read_note per F13)
header tint : neutral (--text-normal / --background-secondary) — read-tool variant
button order: [Allow once] → [Allow for thread] → [Deny]
              DOM + Tab order matches visual order (AC4 of feature.md)
focus       : on mount → primary button `[Allow once]`
              focus trap inside the three buttons until resolve
```

Args are pretty-printed with `JSON.stringify(args, null, 2)` in a `<pre>` block; whitespace is preserved and the region is keyboard-scrollable. Soft cap proposed in [feature.md § Open questions](./feature.md#open-questions) collapses trailing bytes to `… (truncated, N bytes total)` on overflow. No hex literals — colours resolve through Obsidian CSS variables only ([Code style → Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)).

### Wireframe 2 — Read-tool variant (neutral / lower-urgency copy)

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|
+--------------------------------------------------+
| ┌──────────────────────────────────────────────┐ |
| │ [📖] read_note                               │ |   <- green/neutral header
| │      Leo would like to read a note from your │ |      band (read-tool copy is
| │      vault. No changes will be made.         │ |      lower-urgency)
| │                                              │ |
| │ ┌──────────────────────────────────────────┐ │ |
| │ │ {                                        │ │ |
| │ │   "path": "Notes/Inbox/Weekly.md"        │ │ |
| │ │ }                                        │ │ |
| │ └──────────────────────────────────────────┘ │ |
| │                                              │ |
| │  [ Allow once ] [ Allow for thread ] [Deny] │ |
| └──────────────────────────────────────────────┘ |
+--------------------------------------------------+

data-visual-state : "awaiting-confirmation"
data-tool-category: "read"
header tint       : var(--color-green) border + var(--background-secondary) fill
icon              : "book-open" (read family — per [F13](../ui-visual-states-notifications/feature.md))
copy              : "Leo would like to read …" (lower-urgency phrasing)
visible state     : zero colour literals — Obsidian CSS vars only
```

Read-vs-write colour is sourced from Obsidian semantic tokens `var(--color-green)` (read) and `var(--color-orange)` (write), driven by `ToolSpec.requiresConfirmation` category + icon family ([NFR-USE-04](../../context.md#nfr-use-04); [Code style → Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)). A Vitest snapshot asserts the `data-visual-state` attribute differs between read and write specs (AC3 of [feature.md](./feature.md)).

### Wireframe 3 — Write-tool variant (amber / shield / vault-warning)

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|
+--------------------------------------------------+
| ┌══════════════════════════════════════════════┐ |   <- amber header band
| │ [🛡] create_note                             │ |      var(--color-orange)
| │      This will modify your vault.            │ |      border / tint
| │                                              │ |
| │ ┌──────────────────────────────────────────┐ │ |
| │ │ {                                        │ │ |
| │ │   "path": "Notes/Inbox/New.md",          │ │ |
| │ │   "content": "# Draft\n\n..."            │ │ |
| │ │ }                                        │ │ |
| │ └──────────────────────────────────────────┘ │ |
| │                                              │ |
| │  [ Allow once ] [ Allow for thread ] [Deny] │ |
| └══════════════════════════════════════════════┘ |
+--------------------------------------------------+

data-visual-state : "awaiting-confirmation"
data-tool-category: "write"
header tint       : var(--color-orange) border + var(--background-modifier-border)
icon              : "shield" (write family — per [F13](../ui-visual-states-notifications/feature.md))
warning copy      : "This will modify your vault." (high-urgency phrasing)
action order      : identical to read variant — button order never changes
                    (consistent muscle memory — AC4 of feature.md)
```

Write variant tints via `var(--color-orange)` and surfaces the explicit `"This will modify your vault."` warning; the three-button order is unchanged so keyboard users build muscle memory ([FR-CHAT-13](../../context.md#fr-chat-13); [NFR-USE-04](../../context.md#nfr-use-04)). Icon family switches to the write/edit glyph registered in [F13 iconFor](../ui-visual-states-notifications/feature.md).

### Wireframe 4 — Denied-state follow-up (dialog gone, tool-error bubble)

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|
+--------------------------------------------------+
| ...prior transcript...                            |
+--------------------------------------------------+
|  MessageList tail (from F05)                      |
| ┌──────────────────────────────────────────────┐ |
| │ tool · create_note                           │ |   <- tool-error bubble
| │   ⚠  user denied create_note                 │ |      data-visual-state="error"
| └──────────────────────────────────────────────┘ |      var(--text-error)
| ┌──────────────────────────────────────────────┐ |
| │ assistant  2026-04-19 09:13                  │ |   <- follow-up assistant turn
| │   I’ve skipped the write; let me know if …   │ |      streams normally after
| └──────────────────────────────────────────────┘ |      the tool-error is fed back
+--------------------------------------------------+
| InlineConfirmation region: (empty, unmounted)    |
+--------------------------------------------------+

focus return  : ChatView restores focus to the composer (F06)
                after the dialog unmounts (default) OR to the element
                that had focus when the dialog mounted, if still attached
allowedTools  : unchanged (Deny never persists) — thread.metadata.allowedTools
                retains its prior value (AC7 of feature.md)
announce      : assertive SR announce for the tool-error banner
                (via [F07](../chat-streaming-stop/feature.md) / F13 error state)
```

The denied-state follow-up bubble is the standard tool-error bubble surface from [F13 ui-visual-states-notifications](../ui-visual-states-notifications/feature.md) `data-visual-state="error"` — the agent receives `ToolResult{ok:false, error:"user denied <toolId>"}` per [Architecture §7 Error Handling Strategy](../../../../architecture/architecture.md#7-error-handling-strategy) and continues the turn (AC7 of [feature.md](./feature.md)).

## State machine

Two concurrent machines — a controller lifecycle and a focus-trap gate.

### `ConfirmationLifecycleMachine` (per request)

```
  +--------+           tool_confirmation{call, resolve}
  |  idle  | -----------------------------------------> +--------------+
  +--------+                                            |   awaiting   |
      ^                                                 +--------------+
      |                                                  |  |  |  |  |
      | resumed | aborted                       click    |  |  |  |  | click
      |                                     Allow once   |  |  |  |  | Allow for thread
      |                                                  v  |  |  |  v
      |                                      +---------------+  |  +---------------+
      |                                      | resolved:      |  |  | resolved:     |
      |                                      | allow-once     |  |  | allow-thread  |
      |                                      +---------------+  |  +---------------+
      |                                           |             |         |
      |                                           |   click Deny / Esc    |
      |                                           |             v         |
      |                                           |      +---------------+
      |                                           |      | resolved:     |
      |                                           |      | deny          |
      |                                           |      +---------------+
      |                                           |             |
      |                                           v             v
      |                                      +----------+  +-----------+
      +--------------------------------------| resumed  |  | aborted   |
                                             +----------+  +-----------+
                                               (tool runs)  (tool NOT run;
                                                            tool-error fed
                                                            back to graph)
```

Transitions:

- `idle → awaiting` — the agent emits [`StreamEvent.tool_confirmation{call, resolve}`](../../../../architecture/architecture.md#4-key-contracts) via the LangGraph [`interrupt()` pattern](../../../../standards/tech-stack.md#agent--tool--skill--mcp-wiring); the `ChatView` mounts the inline dialog, focus-trap activates.
- `awaiting → resolved(allow-once)` — user clicks `[Allow once]` or Tabs to it and presses Enter/Space; `resolve({decision:"allow-once"})` called; `thread.metadata.allowedTools` NOT mutated (AC5 of feature.md).
- `awaiting → resolved(allow-thread)` — user clicks `[Allow for thread]`; `ConversationStore.mutate(thread.metadata.allowedTools ← dedupe(push(toolId)))` from [F14](../conversation-persistence-v1/feature.md); then `resolve({decision:"allow-thread"})`; allowlist persists across plugin reloads (AC6 of feature.md).
- `awaiting → resolved(deny)` — user clicks `[Deny]` OR presses `Esc`; `resolve({decision:"deny"})`; no mutation (AC7 of feature.md).
- `resolved(allow-once|allow-thread) → resumed` — graph resumes; tool invocation proceeds; bubble turns into `[⟳ <toolId>]` tool-running state from [F13](../ui-visual-states-notifications/feature.md).
- `resolved(deny) → aborted` — tool NOT invoked; `ToolResult{ok:false, error:"user denied <toolId>"}` synthesised and fed back into the graph per [Architecture §7](../../../../architecture/architecture.md#7-error-handling-strategy).
- Any terminal transition → `idle` — the dialog unmounts; focus-trap detaches; resolver reference dropped.

### `FocusTrapMachine` (paired)

```
  +-----------+  awaiting entered   +---------+
  | inactive  | ------------------> | active  |
  +-----------+                     +---------+
       ^                                 |
       |       awaiting left / unmount   |
       +---------------------------------+
```

Invariants:

- `active` — `keydown` on `Tab` / `Shift-Tab` is intercepted and cycled across the three buttons in order `Allow once` → `Allow for thread` → `Deny` → wraps (AC4 of feature.md); `Esc` calls `resolve({decision:"deny"})`; clicks outside the dialog are ignored (no dismiss-on-backdrop-click — the user must pick an explicit decision).
- `inactive` — all keydown listeners removed; focus-return to the previously-focused node (or composer fallback).
- Teardown on `ChatView.onClose` / plugin unload — any pending `awaiting` is forcibly resolved with `{decision:"deny"}` per [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules), and the focus trap transitions `active → inactive`.

Both machines are a Vitest-unit-tested finite state machine per [NFR-TEST-01](../../context.md#nfr-test-01) and [Code style → Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw).

## Event flow

### 1. Agent requests a tool → dialog mounts

1. Turn loop in [F10 `AgentRunner`](../agent-controller-core/feature.md) receives a `tool_call` from the provider stream.
2. `ToolRegistry.lookup(toolId)` from [F16](../tool-registry-builtin-read/feature.md) returns `ToolSpec{ requiresConfirmation: true }`.
3. Pre-invoke gate checks `thread.metadata.allowedTools.includes(toolId)` — if true, bypasses this flow and invokes the tool directly (AC6 of feature.md; [F14](../conversation-persistence-v1/feature.md)).
4. Otherwise, the graph calls LangGraph [`interrupt({call})`](../../../../standards/tech-stack.md#agent--tool--skill--mcp-wiring) which yields a pending state upstream — the turn loop is paused.
5. The pending state is surfaced to the `ChatView` as [`StreamEvent.tool_confirmation{call, resolve}`](../../../../architecture/architecture.md#4-key-contracts) per [Architecture §5.3](../../../../architecture/architecture.md#53-chat-turn-with-tool-call--confirmation).
6. `ChatView` mounts the inline dialog in the `InlineConfirmation` region from [F04](../chat-sidebar-view/feature.md); `data-visual-state="awaiting-confirmation"` is set on the bubble per [F13](../ui-visual-states-notifications/feature.md).
7. `setIcon(iconEl, iconFor(toolId))` paints the tool glyph from the [F13 iconFor registry](../ui-visual-states-notifications/feature.md) via [`setIcon`](../../../../standards/tech-stack.md#platform-apis).
8. `FocusTrapMachine.inactive → active` — `Tab` / `Shift-Tab` / `Esc` keydown listeners attached; focus moves to the primary button `[Allow once]`; `aria-live="assertive"` region fires a one-shot SR announcement "Leo requests permission to use <toolId>" (or "to modify your vault" for write tools) per [NFR-USE-08](../../context.md#nfr-use-08).
9. Structured log event `tool.confirmation.request {toolId, thread}` via the [F01 Logger](../plugin-bootstrap-logging/feature.md).

### 2. User clicks `[Allow once]`

1. `onClick` handler calls `resolve({decision:"allow-once"})` (the resolver passed in via `StreamEvent.tool_confirmation`).
2. `FocusTrapMachine.active → inactive`; focus returns to the prior element (composer fallback).
3. Dialog unmounts from the `InlineConfirmation` region; bubble transitions from `awaiting-confirmation` → `tool-running` via the shared [F13 VisualStateMachine](../ui-visual-states-notifications/feature.md).
4. `thread.metadata.allowedTools` is NOT mutated (AC5 of feature.md).
5. LangGraph resumes the paused graph with the decision; `ToolRegistry.invoke(call)` runs; `tool_result` streams back as usual per [Architecture §5.3](../../../../architecture/architecture.md#53-chat-turn-with-tool-call--confirmation).
6. Structured log event `tool.confirmation.allow-once {toolId, thread, decision:"allow-once"}` via [F01 Logger](../plugin-bootstrap-logging/feature.md).

### 3. User clicks `[Allow for thread]`

1. `onClick` handler calls `ConversationStore.mutate(threadId, draft => { if (!draft.metadata.allowedTools.includes(toolId)) draft.metadata.allowedTools.push(toolId) })` from [F14](../conversation-persistence-v1/feature.md).
2. After `mutate` resolves, handler calls `resolve({decision:"allow-thread"})`.
3. `FocusTrapMachine.active → inactive`; focus returns; dialog unmounts; bubble transitions to `tool-running`.
4. Debounced atomic write in [F14](../conversation-persistence-v1/feature.md) flushes the updated `allowedTools` to disk — persists across plugin reloads (AC6 of feature.md).
5. LangGraph resumes; `ToolRegistry.invoke(call)` runs; subsequent calls of the same tool in the same thread bypass this dialog entirely (pre-invoke gate hit in step 1.3).
6. Structured log event `tool.confirmation.allow-thread {toolId, thread, decision:"allow-thread"}` via [F01 Logger](../plugin-bootstrap-logging/feature.md).

### 4. User clicks `[Deny]` (or presses `Esc`)

1. `onClick` (or `Esc` keydown in `FocusTrapMachine.active`) calls `resolve({decision:"deny"})`.
2. `FocusTrapMachine.active → inactive`; focus returns; dialog unmounts; NO mutation to `thread.metadata.allowedTools` (AC7 of feature.md).
3. The graph resumes in its error branch and synthesises `ToolResult{ok:false, error:"user denied <toolId>"}` per [Architecture §7 Error Handling Strategy](../../../../architecture/architecture.md#7-error-handling-strategy); typed `{ok, error}` surface per [Code style → LangGraph / Agent Layer](../../../../standards/code-style.md#langgraph--agent-layer).
4. A tool-error bubble renders via the [F13 error state](../ui-visual-states-notifications/feature.md) reading `user denied <toolId>`; the follow-up assistant message streams normally.
5. Structured log event `tool.confirmation.deny {toolId, thread, decision:"deny"}` via [F01 Logger](../plugin-bootstrap-logging/feature.md).

### 5. Teardown (unmount, thread switch, plugin unload)

1. On `ChatView.onClose` / thread switch / `plugin.unload()`, any pending `awaiting` confirmation is resolved with `{decision:"deny"}` to avoid a dangling interrupt per [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules).
2. `FocusTrapMachine.active → inactive`; keydown listeners removed via `useEffect` return / `Plugin.registerDomEvent` pairing ([Code style → React 18](../../../../standards/code-style.md#react-18); [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns)).
3. Dialog node unmounts; resolver reference dropped; `AbortSignal` threaded from [F07 chat-streaming-stop](../chat-streaming-stop/feature.md) / [F10](../agent-controller-core/feature.md) aborts the upstream graph when the whole turn is cancelled.
4. No dangling listeners, timers, or DOM nodes remain.

## Component mapping

| UI block | Component / API | Standards reference |
|---|---|---|
| Inline dialog container | React `<div role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={argsId}>` mounted into the `InlineConfirmation` region from [F04 chat-sidebar-view](../chat-sidebar-view/feature.md) — NEVER a native [Obsidian `Modal`](../../../../standards/tech-stack.md#platform-apis) | [Architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views); [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| Focus trap | Custom React hook `useFocusTrap(dialogRef, buttons)` cycling Tab / Shift-Tab across the three buttons in order; Esc calls `resolve({decision:"deny"})` | [Architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views); [Code style → React 18](../../../../standards/code-style.md#react-18) |
| Assertive announcement | `aria-live="assertive"` wrapper on the dialog root — one-shot SR announce on mount | [UI Layer](../../../../standards/tech-stack.md#ui-layer); [Architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) |
| Tool-icon glyph | [`setIcon(iconEl, iconFor(toolId))`](../../../../standards/tech-stack.md#platform-apis) — icon family from the [F13 iconFor registry](../ui-visual-states-notifications/feature.md) ("book-open" for read, "shield"/"file-plus"/"pencil" for write/edit) | [UI Layer → Icons](../../../../standards/tech-stack.md#ui-layer); [Platform APIs](../../../../standards/tech-stack.md#platform-apis) |
| Header title + description | `<h2 id={titleId}>{toolName}</h2>` + `<p>{toolDescription}</p>` — description is the read-tool "no changes will be made" or write-tool "This will modify your vault" copy | [Architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) |
| Pretty-printed args | `<pre id={argsId}>` block containing `JSON.stringify(args, null, 2)` with `white-space: pre`; soft cap collapses trailing bytes | [Code style → React 18](../../../../standards/code-style.md#react-18) |
| Button `[Allow once]` | `<button type="button" aria-label="Allow this call" data-action="allow-once">Allow once</button>` — primary accent; first in Tab order; focused on mount | [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| Button `[Allow for thread]` | `<button type="button" aria-label="Allow for this thread" data-action="allow-thread">Allow for thread</button>` — secondary accent; second in Tab order | [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| Button `[Deny]` | `<button type="button" aria-label="Deny this call" data-action="deny">Deny</button>` — danger accent; third in Tab order; Esc synonym | [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| Button order | DOM + Tab order `Allow once` → `Allow for thread` → `Deny` — never reordered between variants (muscle-memory invariant; AC4) | [Architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) |
| Read-tool tint | `var(--color-green)` border + `var(--background-secondary)` fill — resolved via Obsidian CSS vars | [UI Layer → Styling](../../../../standards/tech-stack.md#ui-layer); [Code style → Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) |
| Write-tool tint | `var(--color-orange)` border + `var(--background-modifier-border)` tint — amber `awaiting-confirmation` palette from [F13](../ui-visual-states-notifications/feature.md) | [UI Layer → Styling](../../../../standards/tech-stack.md#ui-layer); [Code style → Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) |
| Focus ring | `:focus-visible { box-shadow: 0 0 0 2px var(--interactive-accent); outline: none; }` on each button — zero colour literals | [UI Layer → Styling](../../../../standards/tech-stack.md#ui-layer); [Code style → Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) |
| `data-visual-state` attr | `"awaiting-confirmation"` painted on the bubble root per [F13](../ui-visual-states-notifications/feature.md) VisualStateMachine — Vitest snapshot asserts read-vs-write distinction (AC3) | [Architecture §4 Key Contracts](../../../../architecture/architecture.md#4-key-contracts) |
| Allow-for-thread persistence | `ConversationStore.mutate(threadId, draft => draft.metadata.allowedTools.push(toolId))` with dedupe — from [F14 conversation-persistence-v1](../conversation-persistence-v1/feature.md) | [Architecture §6 State Ownership](../../../../architecture/architecture.md#6-state-ownership) |
| Deny → tool-error | `ToolResult{ok:false, error:"user denied <toolId>"}` synthesised and fed back into the LangGraph turn loop | [Architecture §7 Error Handling Strategy](../../../../architecture/architecture.md#7-error-handling-strategy); [Code style → LangGraph / Agent Layer](../../../../standards/code-style.md#langgraph--agent-layer) |
| `interrupt()` wiring | LangGraph [`interrupt()`](../../../../standards/tech-stack.md#agent--tool--skill--mcp-wiring) pauses the graph before `requiresConfirmation` tools and resumes on `resolve({decision})` — no ad-hoc event bus | [Architecture §1](../../../../architecture/architecture.md#1-architectural-principles); [Architecture §5.3](../../../../architecture/architecture.md#53-chat-turn-with-tool-call--confirmation) |
| Keyboard reachability | Every button is a real `<button>` in DOM order; Tab / Shift-Tab cycles inside the trap; Enter / Space activates; Esc === Deny | [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| Esc precedence | Confirmation-dialog Esc beats the [F07 stop-stream Esc](../chat-streaming-stop/feature.md) and the [F06 composer-blur Esc](../chat-composer-input/feature.md) while the dialog is mounted — per [NFR-USE-06](../../context.md#nfr-use-06) | [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| Reduced-motion handling | `@media (prefers-reduced-motion: reduce)` drops any mount fade; state machines and focus trap unchanged | [Code style → Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) |
| Structured logging | `tool.confirmation.request / allow-once / allow-thread / deny` via the [F01 Logger](../plugin-bootstrap-logging/feature.md) with `{toolId, thread, decision}` | [Logging](../../../../standards/code-style.md#logging) |
| React mount / unmount symmetry | `useEffect` return detaches keydown listeners + focus trap; `Plugin.registerDomEvent` pairings tracked on the owning Component; pending `awaiting` resolved with `{decision:"deny"}` on teardown | [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules); [Code style → React 18](../../../../standards/code-style.md#react-18) |
| Unit tests (no-native-Modal, pause-on-requires-confirmation, bypass-when-thread-allowed, allow-once vs allow-thread persistence, deny → tool-error, Esc = Deny, focus-trap, assertive announce, data-visual-state read-vs-write snapshot) | Vitest + jsdom per [NFR-TEST-01](../../context.md#nfr-test-01) | [Testing](../../../../standards/tech-stack.md#testing); [Code style → Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw) |

Accessibility invariants ([Architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views)):

- `role="dialog"` + `aria-modal="true"` + `aria-live="assertive"` on mount; one-shot SR announcement describing the tool and (for write tools) the vault-modification warning ([NFR-USE-08](../../context.md#nfr-use-08), [NFR-USE-07](../../context.md#nfr-use-07)).
- Focus moves to `[Allow once]` on mount; focus trap cycles across the three buttons in order `Allow once` → `Allow for thread` → `Deny`; focus returns to the previously-focused node on resolve.
- `Esc` is synonymous with `Deny` — emits `{decision:"deny"}` regardless of which button inside the trap is focused ([NFR-USE-06](../../context.md#nfr-use-06); AC4 of [feature.md](./feature.md)).
- Keyboard-only operable: every action reachable by Tab / Shift-Tab / Enter / Space / Esc — no pointer required.
- Status never carried by colour alone: read-vs-write distinction is also conveyed by icon family, header copy ("No changes will be made." vs "This will modify your vault."), and `data-tool-category` attribute ([NFR-USE-04](../../context.md#nfr-use-04)).
- `prefers-reduced-motion: reduce` suppresses mount/unmount fade; state machines and focus trap fire identically.
- Zero colour literals — a style audit asserts only Obsidian CSS variables are used in the `InlineConfirmationDialog` styles ([Code style → Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)).
- Never a native Obsidian `Modal` on this path — a Vitest assertion verifies the `Modal` constructor is never invoked when a `requiresConfirmation` tool is reached ([FR-UI-08](../../context.md#fr-ui-08); AC2 of [feature.md](./feature.md)).

## Back-link

[← feature.md](./feature.md)
