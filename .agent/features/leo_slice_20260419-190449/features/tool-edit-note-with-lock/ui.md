# F20 — `edit_note` tool with live edit lock & accept/reject · UI

## Layout

Four ASCII box-drawing wireframes cover the four visible surfaces this feature introduces on top of [F18 edit-lock-transactions](../edit-lock-transactions/feature.md) and [F17 tool-confirmation-flow](../tool-confirmation-flow/feature.md): (1) the active Markdown editor while the lock is held with the target range highlighted by an amber stripe + CM6 readonly decoration, (2) the inline diff panel rendered into the [F04 chat-sidebar-view](../chat-sidebar-view/feature.md) `InlineConfirmation` region showing old → new with `[Accept]` / `[Reject]` buttons, (3) the 3s post-edit success pulse that paints on the active editor after the grouped [`EditorTransaction`](../../../../standards/tech-stack.md#platform-apis) commits, (4) the blocked-keystroke `Notice` toast fired when the user types into the locked range and the reject-reverts toast fired after `Editor.undo()` lands. The diff panel is NEVER an Obsidian native `Modal` per [FR-UI-08](../../context.md#fr-ui-08) and [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns).

### Wireframe 1 — Active editor with locked range (read-only decoration + amber stripe)

```
 0        10        20        30        40        50        60
 |---------|---------|---------|---------|---------|---------|
+--------------------------------------------------------------+
|  Obsidian Markdown leaf  · Notes/Inbox/Weekly.md             |
+--------------------------------------------------------------+
|  38 | ## Follow-ups                                          |
|  39 |                                                        |
|  40 | - ping @alex about the release notes                   |
|  41 |                                                        |
|▓▓42▓|▓-▓finish▓the▓triage▓pass▓on▓inbound▓issues▓▓▓▓▓▓▓▓▓▓▓▓|  <- locked range start
|▓▓43▓|▓-▓draft▓the▓weekly▓email▓(rough▓bullets▓ok)▓▓▓▓▓▓▓▓▓▓▓|     CM6 Decoration.mark
|▓▓44▓|▓▓▓-▓numbers▓from▓Looker▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓|     readonly=true
|▓▓45▓|▓▓▓-▓thanks-to▓line▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓|     amber stripe in
|▓▓46▓|▓-▓schedule▓next▓planning▓slot▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓|     gutter + inline tint
|  47 |                                                        |  <- locked range end
|  48 | ## Links                                               |
|  49 |                                                        |
+--------------------------------------------------------------+

decoration   : CM6 Decoration.mark({class:"leo-edit-lock"}) across
               [line_start, line_end] — amber stripe is background tint
               resolved through var(--color-orange) / var(--background-modifier-border)
               per F18 — zero colour literals in leo source
gutter stripe: CM6 GutterMarker painted on the same line range
               (solid var(--color-orange) strip)
read-only    : CM6 EditorState.readOnly.of(true) scoped to the marked
               range via F18's transactionFilter so keystrokes inside
               the stripe are swallowed
cursor visit : a user Tab / arrow into the range still moves the caret
               but typing fires wireframe 4's Notice toast
ARIA         : CM6 gutter element carries aria-label="Leo is editing
               lines 42–46"; reduced-motion leaves the stripe static
               (no pulsing while locked) per NFR-USE-09
```

The locked range is painted by the F18 `Decoration.mark` extension per [Code style → CodeMirror 6](../../../../standards/code-style.md#codemirror-6); F20 only triggers it by wrapping the `Editor.replaceRange()` call inside [`EditorBridge.withLock(range, fn)`](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules). No colour literals — the amber stripe resolves through Obsidian semantic tokens.

### Wireframe 2 — Inline diff panel in chat (old → new with `[Accept]` `[Reject]`)

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|
+--------------------------------------------------+
| ...transcript bubbles above (from F05)...        |
+--------------------------------------------------+
|  InlineConfirmation region (from F04)            |
| ┌══════════════════════════════════════════════┐ |
| │ [pencil] edit_note                           │ |  <- amber header band
| │  Notes/Inbox/Weekly.md  ·  lines 42–46       │ |     var(--color-orange)
| │                                              │ |
| │ ┌──────────────────────────────────────────┐ │ |
| │ │ - finish the triage pass on inbound iss… │ │ |  <- old block
| │ │ - draft the weekly email (rough bullets… │ │ |     var(--text-muted)
| │ │   - numbers from Looker                  │ │ |     strike-through decoration
| │ │   - thanks-to line                       │ │ |     reuses F05 fenced-code
| │ │ - schedule next planning slot            │ │ |     markdown styling
| │ └──────────────────────────────────────────┘ │ |
| │ ┌──────────────────────────────────────────┐ │ |
| │ │ - finish triage on inbound issues        │ │ |  <- new block
| │ │ - draft weekly email (bullets ok)        │ │ |     var(--text-normal)
| │ │   - Looker numbers                       │ │ |     no strike-through
| │ │   - thanks-to line (Sam, Priya)          │ │ |     reuses F05 fenced-code
| │ │ - schedule next planning slot            │ │ |     markdown styling
| │ └──────────────────────────────────────────┘ │ |
| │                                              │ |
| │              [ Accept ]   [ Reject ]         │ |  <- action row
| └══════════════════════════════════════════════┘ |     primary / danger accents
+--------------------------------------------------+
| ...composer below (from F06)...                  |
+--------------------------------------------------+

dialog anchor  : InlineConfirmation region from [F04](../chat-sidebar-view/feature.md) —
                 never an Obsidian native Modal (FR-UI-08)
role/ARIA      : role="dialog" aria-modal="true" aria-live="polite"
                 aria-labelledby → header title id
                 aria-describedby → "Proposed edit to Notes/Inbox/Weekly.md lines 42 to 46"
icon           : [setIcon(iconEl, "pencil")](../../../../standards/tech-stack.md#platform-apis)
                 (edit family — per [F13 iconFor](../ui-visual-states-notifications/feature.md))
header tint    : var(--color-orange) border + var(--background-modifier-border) fill
                 — amber "awaiting-review" palette, consistent with F17 write-tool variant
old / new vis  : two stacked <pre> blocks reusing the [F05 markdown code-block](../chat-message-list-markdown/feature.md)
                 styling (monospace, white-space: pre, scroll-on-overflow),
                 old block tinted var(--text-muted) + strike-through decoration,
                 new block tinted var(--text-normal)
button order   : [Accept] → [Reject] — DOM + Tab order matches visual order
focus          : on mount → primary button [Accept]
                 focus trap (two-button cycle) until resolve
                 Esc ≡ Reject per NFR-USE-06
non-active fb  : on the non-active-note fallback branch the header drops
                 the "file open" badge but keeps the same diff+button UI
                 per feature.md § Open questions
```

Old/new blocks reuse the [F05 chat-message-list-markdown](../chat-message-list-markdown/feature.md) fenced-code styling per [Code style → Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) so the monospace, line-wrap, and overflow scroll behaviours match the rest of the transcript verbatim. Read-vs-write colour comes from Obsidian semantic tokens — `var(--color-orange)` for the amber band, `var(--text-muted)` for the old block, `var(--text-normal)` for the new block — zero colour literals.

### Wireframe 3 — 3s post-edit success pulse (after Accept or commit)

```
 0        10        20        30        40        50        60
 |---------|---------|---------|---------|---------|---------|
+--------------------------------------------------------------+
|  Obsidian Markdown leaf · Notes/Inbox/Weekly.md              |
+--------------------------------------------------------------+
|  40 | - ping @alex about the release notes                   |
|  41 |                                                        |
|░░42░|░-░finish░triage░on░inbound░issues░░░░░░░░░░░░░░░░░░░░░░|  <- green pulse (3s)
|░░43░|░-░draft░weekly░email░(bullets░ok)░░░░░░░░░░░░░░░░░░░░░░|     Decoration.mark
|░░44░|░░░-░Looker░numbers░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░|     class="leo-edit-highlight"
|░░45░|░░░-░thanks-to░line░(Sam,░Priya)░░░░░░░░░░░░░░░░░░░░░░░░|     var(--color-green) tint
|░░46░|░-░schedule░next░planning░slot░░░░░░░░░░░░░░░░░░░░░░░░░░|     auto-clears on 3s timer
|  47 |                                                        |
+--------------------------------------------------------------+

paint trigger : immediately after the grouped EditorTransaction commits
                (and the lock released), F18's highlights.ts adds the
                "leo-edit-highlight" Decoration.mark over the new range
timer         : window.setTimeout cleared via plugin.register to auto-
                cancel on plugin unload or view detach per
                [Architecture §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules)
animation     : subtle 300ms ease-out fade-in, full hold, 300ms fade-out
                (all inside the 3s window); @media (prefers-reduced-motion: reduce)
                skips the fade and shows a flat 3s solid tint instead
                per NFR-USE-09
data-attr     : editor decoration carries data-leo-highlight="recent-edit"
                so Vitest/jsdom can snapshot-assert presence + clear
a11y          : no focus trap; no ARIA interaction — purely a visual cue
                that layers over the already-committed text
```

The pulse decoration is F18's responsibility per [FR-EDIT-08](../../context.md#fr-edit-08); F20 inherits it automatically because the mutation flows through [`EditorBridge.withLock`](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules). Reduced-motion gate disables the fade per [Code style → Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian).

### Wireframe 4 — Blocked-keystroke Notice (locked range) + reject-reverts Notice

```
 0        10        20        30        40        50        60
 |---------|---------|---------|---------|---------|---------|
+--------------------------------------------------------------+
|  Obsidian Markdown leaf · Notes/Inbox/Weekly.md              |
|  (user taps a key inside the locked range)                   |
+--------------------------------------------------------------+
|                                                              |
|                                       ┌────────────────────┐ |
|                                       │ [!] Leo is editing │ |  <- Notice toast
|                                       │     this range.    │ |     top-right
|                                       │     Accept or      │ |     auto-dismiss
|                                       │     Reject to      │ |     (~5s)
|                                       │     continue.      │ |
|                                       └────────────────────┘ |
+--------------------------------------------------------------+

trigger       : CM6 transactionFilter rejects the keystroke while the
                range is read-only; F18 calls new Notice(...) per
                [FR-EDIT-06](../../context.md#fr-edit-06)
API           : [new Notice(message, ~5000)](../../../../standards/tech-stack.md#platform-apis)
copy          : "Leo is editing this range. Accept or Reject to continue."
SR announce   : Notice is an aria-live="assertive" region by default
                so screen readers announce on fire per NFR-USE-08
reduced-motion: Notice slide-in suppressed under prefers-reduced-motion
                but the toast still appears (static)


+--------------------------------------------------------------+
|  Obsidian Markdown leaf · Notes/Inbox/Weekly.md              |
|  (user clicks [Reject] in the diff panel — Editor.undo() runs)|
+--------------------------------------------------------------+
|                                                              |
|                                       ┌────────────────────┐ |
|                                       │ [x] Edit reverted. │ |  <- reject-revert toast
|                                       │     Back to the    │ |     Notice, ~3s
|                                       │     previous text. │ |     top-right
|                                       └────────────────────┘ |
+--------------------------------------------------------------+

trigger       : onClick(Reject) handler, after Editor.undo() returns
API           : new Notice("Edit reverted. Back to the previous text.", ~3000)
SR announce   : assertive one-shot
icon glyph    : setIcon(iconEl, "x") inside the Notice content DOM node
                per [F13 iconFor](../ui-visual-states-notifications/feature.md) and
                [UI Layer → Icons](../../../../standards/tech-stack.md#ui-layer)
```

Notice is the Obsidian transient-toast channel per [F13 ui-visual-states-notifications](../ui-visual-states-notifications/feature.md); F20 uses it for two distinct events — blocked-keystroke (inside F18) and reject-revert (inside the Reject handler) — both routed through [`new Notice(...)`](../../../../standards/tech-stack.md#platform-apis) per [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns).

## State machine

Two concurrent state machines run for every `edit_note` invocation: (1) the tool lifecycle (`ToolLifecycleMachine`) that owns the confirmation gate and the accept/reject resolution, and (2) the parallel editor-lock overlay (`LockedRangeOverlayMachine`) that owns the CM6 decoration and the readonly gate.

### `ToolLifecycleMachine` (per `edit_note` invocation)

```
  +------+   tool_call{edit_note}       +-------------------+
  | idle | ----------------------------> | confirm-pending   |
  +------+                               +-------------------+
     ^                                     |        |        |
     |                                     | deny   |        | allow-once
     |                                     |        |        | / allow-thread
     |                                     v        |        v
     |                            +---------------+ |  +-----------+
     |                            | rejected      | |  | locked    |
     |                            | (tool-error)  | |  +-----------+
     |                            +---------------+ |        |
     |                                     |        |        | apply ok
     |                                     |        |        v
     |                                     |        |  +-------------------+
     |                                     |        |  | pending-review    |
     |                                     |        |  +-------------------+
     |                                     |        |     |    |       |
     |                                     |        |     |    |       | cancel
     |                                     |        |     |    |       | / throw
     |                                     |        |     |    |       v
     |                                     |        |     |    |  +-----------+
     |                                     |        |     |    |  | rejected  |
     |                                     |        |     |    |  | (aborted) |
     |                                     |        |     |    |  +-----------+
     |                                     |        |     |    |       |
     |                                     |        |     |    v       |
     |                                     |        |     | +----------+|
     |                                     |        |     | | rejected ||
     |                                     |        |     | |(undo run)||
     |                                     |        |     | +----------+|
     |                                     |        |     |    |       |
     |                                     |        |     v    |       |
     |                                     |        | +---------+      |
     |                                     |        | | accepted|      |
     |                                     |        | +---------+      |
     |                                     |        |     |            |
     +-------------------------------------+--------+-----+------------+
                                           |
                                         (all terminal transitions
                                          return to idle; lock released
                                          in finally; log event fires)
```

Transitions:

- `idle → confirm-pending` — `tool_call{name:"edit_note", args}` reaches the [F10 AgentRunner](../agent-controller-core/feature.md) turn loop; `ToolRegistry.lookup("edit_note").requiresConfirmation === true` hits the [F17](../tool-confirmation-flow/feature.md) gate; LangGraph [`interrupt()`](../../../../standards/tech-stack.md#agent--tool--skill--mcp-wiring) pauses the graph; the [F17](../tool-confirmation-flow/feature.md) inline confirmation dialog mounts (write-tool amber palette).
- `confirm-pending → rejected(tool-error)` — user clicks `[Deny]` or presses `Esc` in the F17 dialog; `ToolResult{ok:false, error:"user denied edit_note"}` is synthesised per [Architecture §7](../../../../architecture/architecture.md#7-error-handling-strategy); no lock ever acquired.
- `confirm-pending → locked` — user picks `[Allow once]` or `[Allow for thread]` (or the tool id is already in `thread.metadata.allowedTools` per [FR-AGENT-10](../../context.md#fr-agent-10)); `EditorBridge.withLock(range, fn)` acquires the lock; CM6 `Decoration.mark({readonly:true, class:"leo-edit-lock"})` is painted across `[line_start, line_end]` per [F18](../edit-lock-transactions/feature.md).
- `locked → pending-review` — inside `withLock`, a single grouped [`EditorTransaction`](../../../../standards/tech-stack.md#platform-apis) wrapping `Editor.replaceRange(new_content, from, to)` commits atomically per [FR-EDIT-05](../../context.md#fr-edit-05); the lock is released in `finally`; the [F18](../edit-lock-transactions/feature.md) 3s success pulse starts; the inline diff panel mounts in the [F04 InlineConfirmation region](../chat-sidebar-view/feature.md) showing old → new + `[Accept]` / `[Reject]` per [FR-EDIT-09](../../context.md#fr-edit-09).
- `pending-review → accepted` — user clicks `[Accept]`; no editor mutation (the edit has already landed); diff panel unmounts; `ToolResult{ok:true, data:{accepted:true}}` is streamed back to the graph; structured `edit_note.accept` log event fires.
- `pending-review → rejected(undo run)` — user clicks `[Reject]` (or presses `Esc`); `Editor.undo()` runs exactly once on the active editor — because the mutation was a single grouped [`EditorTransaction`](../../../../standards/tech-stack.md#platform-apis) the content reverts in one hop per [FR-EDIT-09](../../context.md#fr-edit-09); the reject-revert Notice fires (wireframe 4); diff panel unmounts; `ToolResult{ok:true, data:{accepted:false}}` is streamed back; structured `edit_note.reject` log event fires.
- `pending-review → rejected(aborted)` — the turn's `AbortController` fires while the diff panel is mounted (user pressed Stop from [F07](../chat-streaming-stop/feature.md), or `ChatView.onClose`, or `plugin.unload()`); the diff panel forcibly resolves as Reject per [Architecture §5.6](../../../../architecture/architecture.md#56-cancellation); `Editor.undo()` runs; lock was already released by the `finally` — no double-release; log event fires.
- `locked → rejected(aborted)` — the `AbortSignal` fires or the transaction throws before commit; `withLock`'s `try { apply } finally { release }` invariant per [FR-EDIT-07](../../context.md#fr-edit-07) / [NFR-REL-04](../../context.md#nfr-rel-04) releases the lock; no partial mutation escapes per [Architecture §7](../../../../architecture/architecture.md#7-error-handling-strategy); tool-error fed back to the graph.
- Any terminal → `idle` — diff panel unmounts; timer-backed 3s pulse continues independently and self-clears on its own timer or view detach per [Architecture §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules); resolver reference dropped; structured `tool.invoke.ok` / `tool.invoke.error` log event fires via [F01 Logger](../plugin-bootstrap-logging/feature.md).

### `LockedRangeOverlayMachine` (parallel, per active-note invocation)

```
  +----------+  withLock acquire      +--------+
  | unlocked | ----------------------> | locked |
  +----------+                         +--------+
       ^                                   |
       |       withLock finally            |
       |       release (accept / reject /  |
       |       cancel / throw — all paths) |
       +-----------------------------------+
```

Invariants:

- `unlocked` — no CM6 `Decoration.mark` painted; no readonly guard; no amber stripe; user may type normally.
- `locked` — CM6 `Decoration.mark` (amber stripe + gutter marker) applied across `[line_start, line_end]`; CM6 `transactionFilter` swallows any user keystroke inside the range and fires the blocked-keystroke Notice (wireframe 4) per [F18](../edit-lock-transactions/feature.md) / [FR-EDIT-06](../../context.md#fr-edit-06).
- Teardown on `ChatView.onClose` / thread switch / `plugin.unload()` / view detach — any still-acquired lock is forcibly released by F18's lifecycle hook per [Architecture §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules); the `pending-review` diff panel (if still mounted) is auto-resolved as Reject so the [`EditorTransaction`](../../../../standards/tech-stack.md#platform-apis) reverts via `Editor.undo()` before detach.
- Fallback branch (non-active-note) — `LockedRangeOverlayMachine` stays in `unlocked` for the entire invocation because the mutation goes through `VaultAdapter.read → splice → modify` per [F19 tools-write-vault](../tools-write-vault/feature.md); the `ToolLifecycleMachine` still runs the `confirm-pending → accepted|rejected` path, but Reject reverts via a pre-edit snapshot + `VaultAdapter.modify(path, pre)` per [feature.md § Open questions](./feature.md#open-questions) instead of `Editor.undo()`.

Both machines are Vitest-unit-tested finite state machines per [NFR-TEST-01](../../context.md#nfr-test-01) and [Code style → Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw).

## Event flow

### 1. Agent invokes `edit_note` → confirmation gate

1. `AgentRunner` ([F10](../agent-controller-core/feature.md)) receives `tool_call{name:"edit_note", arguments:{path, line_start, line_end, new_content}}` from the provider stream.
2. `ToolRegistry.lookup("edit_note")` ([F16](../tool-registry-builtin-read/feature.md)) returns `ToolSpec{requiresConfirmation:true, ...}`; Zod schema validates `arguments`; path-traversal guard rejects `..` / absolute / out-of-vault paths with `ToolResult{ok:false, error:"unsafe path"}` per [FR-AGENT-05](../../context.md#fr-agent-05) / AC3 of [feature.md](./feature.md).
3. Pre-invoke allowlist check — if `thread.metadata.allowedTools.includes("edit_note")` (persisted by [F14](../conversation-persistence-v1/feature.md) from a prior `[Allow for thread]`), skip to step 5.
4. Else, LangGraph [`interrupt()`](../../../../standards/tech-stack.md#agent--tool--skill--mcp-wiring) pauses; `StreamEvent.tool_confirmation{call, resolve}` surfaces to `ChatView`; [F17](../tool-confirmation-flow/feature.md) mounts the inline confirmation dialog in write-tool amber palette showing `{path, line_start, line_end, new_content}` pretty-printed; user picks `[Allow once]` / `[Allow for thread]` / `[Deny]`; Deny path ends here with `ToolResult{ok:false, error:"user denied edit_note"}`.

### 2. Allowed → `EditorBridge.withLock` acquires the range

5. Route check — `const file = app.workspace.getActiveViewOfType(MarkdownView)?.file` compared to the `TFile` at `path`; if they match, take the active-note branch (steps 6-9); else take the fallback branch (step 10).
6. (Active-note branch) `EditorBridge.withLock({line_start, line_end}, fn)` is called per [Architecture §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules); the lock semaphore acquires; `LockedRangeOverlayMachine.unlocked → locked`.
7. CM6 `Decoration.mark({class:"leo-edit-lock", readonly:true})` is painted across `[line_start, line_end]` via F18's `StateField`; the amber stripe + gutter marker appears (wireframe 1); CM6 `transactionFilter` starts swallowing user keystrokes inside the range and firing the blocked-keystroke `Notice` toast per [F18](../edit-lock-transactions/feature.md) / [FR-EDIT-06](../../context.md#fr-edit-06) (wireframe 4).

### 3. `replaceRange` via `EditorTransaction`

8. Inside `withLock`'s `fn`, a single grouped [`EditorTransaction`](../../../../standards/tech-stack.md#platform-apis) wraps `Editor.replaceRange(new_content, from, to)` per [FR-EDIT-05](../../context.md#fr-edit-05) / [Code style → CodeMirror 6](../../../../standards/code-style.md#codemirror-6) — one transaction ≡ one undo hop per [FR-EDIT-09](../../context.md#fr-edit-09).
9. `withLock`'s `finally` releases the lock; `LockedRangeOverlayMachine.locked → unlocked`; CM6 decoration removed; readonly guard removed; [F18](../edit-lock-transactions/feature.md) starts the 3s post-edit pulse (wireframe 3) per [FR-EDIT-08](../../context.md#fr-edit-08).
10. (Non-active-note branch, skipped otherwise) `const pre = await vault.read(file); const next = splice(pre, line_start, line_end, new_content); await vault.modify(file, next);` via [`VaultAdapter`](../../../../architecture/architecture.md#34-adapters) per [F19](../tools-write-vault/feature.md); `pre` is retained in memory for the Reject snapshot per [feature.md § Open questions](./feature.md#open-questions).

### 4. Inline diff panel mounts

11. `ChatView` mounts the inline diff panel (wireframe 2) into the [F04 InlineConfirmation region](../chat-sidebar-view/feature.md) — never an Obsidian native [`Modal`](../../../../standards/tech-stack.md#platform-apis) per [FR-UI-08](../../context.md#fr-ui-08); header shows `{path, line_start, line_end}`; old block rendered from `pre` snapshot, new block rendered from `new_content`, both reusing the [F05 markdown code-block](../chat-message-list-markdown/feature.md) styling.
12. `data-visual-state="pending-review"` set on the bubble root per [F13 VisualStateMachine](../ui-visual-states-notifications/feature.md); `setIcon(iconEl, "pencil")` paints the edit glyph; `role="dialog" aria-modal="true" aria-live="polite"` applied; focus moves to `[Accept]`; two-button focus trap installs (Tab cycles `Accept → Reject → Accept`); Esc ≡ Reject.
13. Structured log event `tool.invoke.ok {toolId:"edit_note", thread, path, routedVia:"editor"|"vault", durationMs}` via [F01 Logger](../plugin-bootstrap-logging/feature.md) per [Code style → Logging](../../../../standards/code-style.md#logging); content payload never logged.

### 5. User presses `[Accept]` → lock released + 3s highlight finishes

14. `onClick([Accept])` handler calls `resolve({decision:"accept"})`; the diff panel unmounts; focus returns to the composer (F06 fallback) or the prior focused node.
15. No editor mutation — the edit has already landed and the lock has already been released in `withLock`'s `finally` (step 9).
16. The 3s success pulse (wireframe 3) continues independently and self-clears on its `setTimeout` per [Architecture §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules); if it has already cleared (e.g. user took > 3s to accept), no extra paint is added.
17. `ToolResult{ok:true, data:{accepted:true}}` returned to the graph; LangGraph resumes the paused turn; `tool_result` streams back as usual per [Architecture §5.3](../../../../architecture/architecture.md#53-chat-turn-with-tool-call--confirmation).
18. Structured log event `edit_note.accept {toolId, thread, path, routedVia, durationMs}` via [F01 Logger](../plugin-bootstrap-logging/feature.md).

### 6. User presses `[Reject]` → `Editor.undo()` reverts + lock released

19. `onClick([Reject])` handler calls `resolve({decision:"reject"})`; the diff panel unmounts; focus returns.
20. (Active-note branch) handler calls `editor.undo()` exactly once on the active `MarkdownView.editor` per [FR-EDIT-09](../../context.md#fr-edit-09); because the mutation was a single grouped [`EditorTransaction`](../../../../standards/tech-stack.md#platform-apis) per [F18](../edit-lock-transactions/feature.md), the buffer reverts in one hop; AC6 / AC7 of [feature.md](./feature.md) assert this via a Vitest snapshot equality with the pre-edit content.
21. (Non-active-note branch) handler calls `vault.modify(file, pre)` using the snapshot captured in step 10 per [feature.md § Open questions](./feature.md#open-questions); buffer on disk reverts.
22. The reject-revert Notice fires (wireframe 4, bottom): `new Notice("Edit reverted. Back to the previous text.", 3000)` per [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns); `setIcon` paints the `x` glyph inside the toast.
23. `ToolResult{ok:true, data:{accepted:false}}` returned to the graph; the follow-up assistant message streams normally acknowledging the reject.
24. Structured log event `edit_note.reject {toolId, thread, path, routedVia, durationMs}` via [F01 Logger](../plugin-bootstrap-logging/feature.md); AC8 of [feature.md](./feature.md) asserts the Reject branch only calls `Editor.undo()` AFTER the lock has been released, never while held.

### 7. Cancel or error → `finally` releases lock (and auto-Reject on pending-review)

25. Any `AbortSignal` fire or thrown exception inside `withLock` → `withLock`'s `finally` releases the lock per [FR-EDIT-07](../../context.md#fr-edit-07) / [NFR-REL-04](../../context.md#nfr-rel-04); [Architecture §5.6](../../../../architecture/architecture.md#56-cancellation) "Active edit locks released in `finally` on every exit path" is the governing invariant; `LockedRangeOverlayMachine.locked → unlocked`.
26. If the abort/error fires while the diff panel is mounted in `pending-review`, the panel auto-resolves as Reject: `editor.undo()` runs; content reverts; panel unmounts; `ToolResult{ok:false, error:"cancelled"}` fed back to the graph.
27. Structured log event `tool.invoke.error {toolId, thread, path, routedVia, durationMs, error}` via [F01 Logger](../plugin-bootstrap-logging/feature.md); no exception escapes `invoke` per AC9 of [feature.md](./feature.md).
28. AC8 of [feature.md](./feature.md) asserts acquire/release symmetry (one `acquire` ↔ one `release`) across all four exit paths — accept, reject, cancel, throw.

## Component mapping

| UI block | Component / API | Standards reference |
|---|---|---|
| Locked range overlay | CM6 `Decoration.mark({class:"leo-edit-lock", readonly:true})` + `GutterMarker` painted across `[line_start, line_end]` via F18's `StateField` | [Code style → CodeMirror 6](../../../../standards/code-style.md#codemirror-6); [Architecture §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) |
| Readonly guard | CM6 `EditorState.transactionFilter.of(...)` swallowing user keystrokes inside the locked range; fires `new Notice("Leo is editing this range …")` on reject | [Platform APIs](../../../../standards/tech-stack.md#platform-apis); [Code style → CodeMirror 6](../../../../standards/code-style.md#codemirror-6) |
| Atomic edit | Single grouped [`EditorTransaction`](../../../../standards/tech-stack.md#platform-apis) wrapping `Editor.replaceRange(new_content, from, to)` so `Editor.undo()` reverts in one hop | [Platform APIs](../../../../standards/tech-stack.md#platform-apis); [Code style → CodeMirror 6](../../../../standards/code-style.md#codemirror-6); [Architecture §4](../../../../architecture/architecture.md#4-key-contracts) |
| Lock acquire/release | [`EditorBridge.withLock(range, fn)`](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) with `try { apply } finally { release }`; sole active-note mutation entry point | [Architecture §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules); [Code style → Error Handling](../../../../standards/code-style.md#error-handling) |
| 3s post-edit pulse | CM6 `Decoration.mark({class:"leo-edit-highlight"})` with `window.setTimeout(clear, 3000)` registered on the owning `Component` for symmetric teardown | [Architecture §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules); [Code style → CodeMirror 6](../../../../standards/code-style.md#codemirror-6) |
| Amber stripe tint | `var(--color-orange)` + `var(--background-modifier-border)` resolved through Obsidian CSS variables — zero colour literals | [UI Layer → Styling](../../../../standards/tech-stack.md#ui-layer); [Code style → Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) |
| Green pulse tint | `var(--color-green)` + `var(--background-modifier-border)` resolved through Obsidian CSS variables — zero colour literals | [UI Layer → Styling](../../../../standards/tech-stack.md#ui-layer); [Code style → Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) |
| Inline diff panel container | React `<div role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={argsId}>` mounted into the [F04 InlineConfirmation region](../chat-sidebar-view/feature.md) — NEVER a native [Obsidian `Modal`](../../../../standards/tech-stack.md#platform-apis) per [FR-UI-08](../../context.md#fr-ui-08) | [Architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views); [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| Old / new diff blocks | Two stacked `<pre>` blocks reusing the [F05 chat-message-list-markdown](../chat-message-list-markdown/feature.md) fenced-code styling (monospace, `white-space: pre`, overflow scroll); old block tinted `var(--text-muted)` with strike-through decoration, new block tinted `var(--text-normal)` | [UI Layer → Styling](../../../../standards/tech-stack.md#ui-layer); [Code style → Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) |
| Diff panel header | `<h2 id={titleId}>edit_note</h2>` + `<p>{path} · lines {line_start}–{line_end}</p>`; amber band via `var(--color-orange)` | [Architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) |
| Tool-icon glyph | [`setIcon(iconEl, "pencil")`](../../../../standards/tech-stack.md#platform-apis) — edit family from the [F13 iconFor registry](../ui-visual-states-notifications/feature.md) | [UI Layer → Icons](../../../../standards/tech-stack.md#ui-layer); [Platform APIs](../../../../standards/tech-stack.md#platform-apis) |
| Accept button | `<button type="button" aria-label="Accept Leo's edit" data-action="accept">Accept</button>` + inner `setIcon("check")` — primary accent; first in Tab order; focused on mount | [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns); [UI Layer → Icons](../../../../standards/tech-stack.md#ui-layer) |
| Reject button | `<button type="button" aria-label="Reject Leo's edit" data-action="reject">Reject</button>` + inner `setIcon("x")` — danger accent; second in Tab order; Esc synonym | [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns); [UI Layer → Icons](../../../../standards/tech-stack.md#ui-layer) |
| Focus trap | `useFocusTrap(dialogRef, [acceptBtn, rejectBtn])` two-button cycle; Esc calls `resolve({decision:"reject"})` | [Architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views); [Code style → React 18](../../../../standards/code-style.md#react-18) |
| Focus ring | `:focus-visible { box-shadow: 0 0 0 2px var(--interactive-accent); outline: none; }` on each button — zero colour literals | [UI Layer → Styling](../../../../standards/tech-stack.md#ui-layer); [Code style → Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) |
| Esc precedence | Diff-panel Esc beats [F07 stop-stream Esc](../chat-streaming-stop/feature.md) and [F06 composer-blur Esc](../chat-composer-input/feature.md) while the panel is mounted per [NFR-USE-06](../../context.md#nfr-use-06) | [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| `Editor.undo()` reject | `editor.undo()` called once on the `MarkdownView.editor` — reverts the grouped `EditorTransaction` in one hop per [FR-EDIT-09](../../context.md#fr-edit-09) | [Platform APIs](../../../../standards/tech-stack.md#platform-apis); [Code style → CodeMirror 6](../../../../standards/code-style.md#codemirror-6) |
| Non-active revert | `VaultAdapter.modify(path, pre)` using a pre-edit snapshot captured before the write per [feature.md § Open questions](./feature.md#open-questions) | [Architecture §3.4](../../../../architecture/architecture.md#34-adapters); [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| Blocked-keystroke Notice | `new Notice("Leo is editing this range. Accept or Reject to continue.", 5000)` fired by F18's `transactionFilter` when a user keystroke hits the locked range | [Platform APIs](../../../../standards/tech-stack.md#platform-apis); [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| Reject-revert Notice | `new Notice("Edit reverted. Back to the previous text.", 3000)` fired by the Reject handler after `Editor.undo()` / `VaultAdapter.modify(path, pre)` returns | [Platform APIs](../../../../standards/tech-stack.md#platform-apis); [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| `data-visual-state` attr | `"pending-review"` painted on the bubble root per [F13 VisualStateMachine](../ui-visual-states-notifications/feature.md) — Vitest snapshot asserts the value | [Architecture §4](../../../../architecture/architecture.md#4-key-contracts) |
| Reduced-motion handling | `@media (prefers-reduced-motion: reduce)` disables the 3s pulse fade (shows flat tint), the Notice slide-in, and any panel mount transition; state machines and focus trap fire identically | [Code style → Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) |
| `AbortSignal` plumbing | Threaded from [F07 chat-streaming-stop](../chat-streaming-stop/feature.md) / [F10 AgentRunner](../agent-controller-core/feature.md) through `ToolCtx.signal` per [Code style → LangGraph / Agent Layer](../../../../standards/code-style.md#langgraph--agent-layer); aborts auto-Reject the pending-review diff panel | [Architecture §5.6](../../../../architecture/architecture.md#56-cancellation); [Code style → LangGraph / Agent Layer](../../../../standards/code-style.md#langgraph--agent-layer) |
| Structured logging | `tool.invoke.start / tool.invoke.ok / tool.invoke.error` + `edit_note.accept / edit_note.reject` with `{toolId, thread, path, routedVia, durationMs}` (never content payload) via [F01 Logger](../plugin-bootstrap-logging/feature.md) | [Code style → Logging](../../../../standards/code-style.md#logging) |
| React mount / unmount symmetry | `useEffect` return detaches keydown listeners + focus trap; `Plugin.registerDomEvent` pairings tracked on the owning `Component`; pending `pending-review` auto-resolved as Reject on `ChatView.onClose` / plugin unload | [Architecture §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules); [Code style → React 18](../../../../standards/code-style.md#react-18) |
| Never a native Modal | Vitest assertion that the [`Modal`](../../../../standards/tech-stack.md#platform-apis) constructor is never invoked along the diff-panel mount path per [FR-UI-08](../../context.md#fr-ui-08) / AC5 of [feature.md](./feature.md) | [Architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views); [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| Unit tests (registration + `requiresConfirmation:true`, active-note routes through `withLock`, non-active-note routes through `VaultAdapter.modify`, Accept no-op, Reject calls `Editor.undo()` once, native Ctrl/Cmd-Z reverts atomically, acquire/release symmetry on all four exit paths, blocked-keystroke Notice fired, reject-revert Notice fired, reduced-motion pulse gate, Esc ≡ Reject, focus-trap two-button cycle, `data-visual-state="pending-review"` snapshot, no-native-Modal assertion) | Vitest + jsdom per [NFR-TEST-01](../../context.md#nfr-test-01) | [Testing](../../../../standards/tech-stack.md#testing); [Code style → Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw) |

Accessibility invariants ([Architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views)):

- `role="dialog"` + `aria-modal="true"` + `aria-live="polite"` on the diff panel on mount; SR announcement describes the proposed edit ("Proposed edit to <path> lines <line_start> to <line_end>") per [NFR-USE-08](../../context.md#nfr-use-08).
- Focus moves to `[Accept]` on mount; two-button focus trap cycles `Accept → Reject → Accept`; focus returns to the previously-focused node (composer fallback) on resolve.
- `Esc` is synonymous with `Reject` — emits `{decision:"reject"}` regardless of which button is focused per [NFR-USE-06](../../context.md#nfr-use-06).
- Keyboard-only operable: every action reachable by Tab / Shift-Tab / Enter / Space / Esc — no pointer required.
- Status never carried by colour alone: the amber stripe + `data-visual-state="pending-review"` attribute + header copy ("edit_note · lines 42–46") + `pencil` icon all convey the edit intent independently of hue per [NFR-USE-04](../../context.md#nfr-use-04).
- `prefers-reduced-motion: reduce` suppresses the 3s pulse fade, the Notice slide-in, and any panel mount transition; state machines, focus trap, and decoration paint fire identically.
- Zero colour literals — a style audit asserts only Obsidian CSS variables are used in the diff-panel and edit-lock styles per [Code style → Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian).
- Never a native Obsidian `Modal` on this path — Vitest asserts the `Modal` constructor is never invoked when `edit_note` surfaces the diff panel per [FR-UI-08](../../context.md#fr-ui-08) / AC5 of [feature.md](./feature.md).

## Back-link

[← feature.md](./feature.md)
