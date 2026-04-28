# F13 — Visual states & notifications policy · UI

## Layout

This feature does not ship a visual flow of its own — it defines the shared vocabulary that every later chat feature consumes. The wireframes below therefore render a _gallery of states_ attached to the six-region shell scaffolded by [F04](../chat-sidebar-view/feature.md), the per-tool icon legend resolved via [`setIcon`](../../../../standards/tech-stack.md#platform-apis), and the notification placement matrix for [`Notice`](../../../../standards/tech-stack.md#platform-apis), [`addStatusBarItem`](../../../../standards/tech-stack.md#platform-apis), and the inline modal mounted into the `InlineDialog` region. Every colour resolves through Obsidian CSS variables per [Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) and [UI Layer — Styling](../../../../standards/tech-stack.md#ui-layer); zero hardcoded hex values. State-change animations are gated by `@media (prefers-reduced-motion: reduce)` so `data-visual-state` attributes still update for assistive tech even when motion is disabled ([UI Layer — Styling](../../../../standards/tech-stack.md#ui-layer)). Colour contrast for amber / red / muted palettes is picked from Obsidian semantic tokens (`--color-orange`, `--text-error`, `--text-muted`) to inherit theme-chosen WCAG AA pairings rather than shipping our own.

### Wireframe 1 — Gallery of visual states attached to `MessageList` / `ComposerInput`

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|
+-------------------------------------------------+
| MessageList — state gallery (one bubble each)   |
+-------------------------------------------------+
| +---------------------------------------------+ |
| | assistant                         data-     | |  idle
| | Ready.                     visual-state=    | |  -> fg: --text-normal
| |                              "idle"         | |     border: --background-
| +---------------------------------------------+ |              modifier-border
|                                                 |
| +---------------------------------------------+ |
| | assistant                         data-     | |  streaming
| | Streaming tokens now...▋   visual-state=    | |  -> cursor ▋ via ::after
| |                          "streaming"        | |     pulse gated by rm-media
| +---------------------------------------------+ |
|                                                 |
| +---------------------------------------------+ |
| | assistant                         data-     | |  tool-running
| | [⟳ read_note] reading Inbox.md   visual-    | |  -> fg: --text-accent
| |                           state=             | |     spinner ⟳ rm-safe dot
| |                         "tool-running"      | |
| +---------------------------------------------+ |
|                                                 |
| +---------------------------------------------+ |
| | [!] write_note — requires confirmation       | |  awaiting-confirmation
| | ┌───────────────────────────────────┐        | |  -> border: --color-orange
| | │ path: Notes/Draft.md              │        | |     bg:     --background-
| | │ body: "..."                       │        | |             modifier-border
| | │  [Allow once] [Allow] [Deny]      │        | |  inline InlineConfirmation
| | └───────────────────────────────────┘        | |  region (NEVER native modal)
| +---------------------------------------------+ |
|                                                 |
| +---------------------------------------------+ |
| | (X) error: connection reset      data-      | |  error
| | Retry | Dismiss             visual-state=    | |  -> border: --text-error
| |                             "error"          | |     bg: --background-
| +---------------------------------------------+ |              modifier-error
|                                                 |
| +---------------------------------------------+ |
| | assistant (cancelled)           data-       | |  cancelled
| | (partial) ...                  visual-      | |  -> fg: --text-muted
| | cancelled after 2 tools        state=        | |     opacity: 0.7
| |                          "cancelled"         | |     muted amber border
| +---------------------------------------------+ |
|                                                 |
| +---------------------------------------------+ |
| | editor overlay (CM6)            data-       | |  edit-locked
| | ░░ highlighted 3s after write ░░ visual-     | |  -> bg: --text-accent w/
| |                           state=             | |         low alpha overlay
| |                        "edit-locked"          | |     applied to editor, not
| +---------------------------------------------+ |      MessageList (parallel)
+-------------------------------------------------+
```

- Each `data-visual-state="<name>"` attribute is applied to the active region (bubble, banner, or CM6 overlay) by the shared `VisualStateMachine` exported from this feature ([Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views)). The attribute survives motion-reduction; only the pulse / spin keyframes are suppressed ([UI Layer — Styling](../../../../standards/tech-stack.md#ui-layer)).
- The `awaiting-confirmation` row is mounted into the `InlineConfirmation` slot of the [F04](../chat-sidebar-view/feature.md) shell; F17 fills the dialog content in a later slice — this feature only owns the channel routing and the amber palette.
- `edit-locked` is a _parallel_ state: the editor pane, not the chat pane, carries the `data-visual-state="edit-locked"` attribute. F18 paints the CM6 decoration; this feature only owns the token and the highlight palette.

### Wireframe 2 — Per-tool icon legend

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|
+-------------------------------------------------+
| Icon legend (resolved via setIcon(toolIcon))    |
+-------------------------------------------------+
|  [book-open]   read      -> read_note           |
|  [file-plus]   write     -> create_note         |
|  [pencil]      edit      -> edit_note /         |
|                             append_to_note      |
|  [search]      search    -> search_vault        |
|                                                 |
|  [plug-zap]    MCP       -> mcp.<serverId>.*    |
|                "<server-name>" label slot        |
|                populated later by F51+          |
+-------------------------------------------------+
```

- Icon names are Lucide glyphs bundled with Obsidian; `setIcon(el, "book-open")` style calls route through [`setIcon`](../../../../standards/tech-stack.md#platform-apis) — no runtime icon-font fetch ([UI Layer — Icons](../../../../standards/tech-stack.md#ui-layer)).
- `mcp.<serverId>.<tool>` ids resolve to the generic `plug-zap` glyph plus a `<server-name>` label; the lookup is consumer-supplied and stays empty until F51+ provides the MCP registry ([Architecture §4 Key Contracts](../../../../architecture/architecture.md#4-key-contracts)).
- The registry is pure and side-effect free; consumers call `iconFor(toolId)` which returns `{ icon, label? }` and then paint via `setIcon`. No DOM mutation occurs inside `iconFor` itself ([Code style — React 18](../../../../standards/code-style.md#react-18)).

### Wireframe 3 — Notification gallery (three channels + one forbidden)

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|

Channel 1 — Notice (transient success / info)        [Notifications.notice]
+-------------------------------------------------+
|                                  +------------+ |
|                                  | Copied.    | |   <- Obsidian Notice toast
|                                  +------------+ |      3–4s auto-dismiss
+-------------------------------------------------+      top-right, native

Channel 2 — Status bar (persistent connectivity)     [Notifications.status]
+-------------------------------------------------+
| ChatView content region                         |
| ...                                             |
+-------------------------------------------------+
|[LM Studio: connected]  [index: 42%]  [MCP: -- ]| <- addStatusBarItem entries
+-------------------------------------------------+    keyed; replace-on-update
                                                       removed on unload

Channel 3 — Inline modal in InlineDialog region      [Notifications.blockingError]
+-------------------------------------------------+
| HeaderBar | ContextIndicator                    |
|-------------------------------------------------|
| MessageList (dimmed while modal open)           |
|                                                 |
|     +-------------------------------------+     |
|     | (X) Unable to reach LM Studio.      |     |  <- inline modal, mounted
|     |     [Open settings] [Dismiss]       |     |     into InlineDialog slot
|     +-------------------------------------+     |     from F04; NOT an
|                                                 |     Obsidian native Modal
|-------------------------------------------------|
| ComposerInput (disabled while modal open)       |
+-------------------------------------------------+

FORBIDDEN — tool confirmation must never open a native Modal
+-------------------------------------------------+
| (X) NEVER:  new Modal(app).open()  for tool     |
|     confirmation. Route to InlineConfirmation   |
|     region from F04 (Wireframe 1 above).        |
+-------------------------------------------------+
```

- `notice(message)` wraps Obsidian's [`Notice`](../../../../standards/tech-stack.md#platform-apis); reserved for transient success / info per [FR-UI-08](../../context.md#fr-ui-08) and [Architecture §7 Error Handling Strategy](../../../../architecture/architecture.md#7-error-handling-strategy).
- `status(key, message)` replaces the keyed entry in-place via [`addStatusBarItem`](../../../../standards/tech-stack.md#platform-apis); owners register the entry with `Plugin.register(() => entry.remove())` for clean teardown per [Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) and [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules).
- `blockingError(content)` mounts a React portal into the `InlineDialog` region from [F04](../chat-sidebar-view/feature.md). The z-index contract (Notice > Modal > InlineDialog > Tooltip > EditLock > Content) established by F04 is inherited; no new layers are introduced.
- Tool confirmations are routed exclusively to the `InlineConfirmation` slot. A unit test asserts the code path never imports or invokes Obsidian's `Modal` constructor ([FR-UI-08](../../context.md#fr-ui-08), [Code style — Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw)).

## State machine

Turn-level visual state, consumed by every later feature. Edit-lock is a parallel (orthogonal) state — the editor region carries it independently of the chat turn.

```
Primary — turn-level VisualStateMachine

   +--------+
   |  idle  |<-----------------------------------------+
   +---+----+                                          |
       | provider yields first token                   |
       v                                               |
   +-----------+  tool_call start   +--------------+   |
   | streaming |------------------->| tool-running |---+
   +-----+-----+                    +------+-------+   |
       ^ |                                 | requires- |
       | | tool_result                     | Confirma- |
       | +---------------------------------+ tion=true |
       |                                   v           |
       |                      +----------------------+ |
       |                      | awaiting-confirma-   | |
       |                      | tion  (amber)        | |
       |                      +-----+----------+-----+ |
       |                            | allow    | deny  |
       |                            v          v       |
       |                    +--------------+  (returns |
       +--------------------|  tool-running|   tool    |
                            +------+-------+   error,  |
                                   |          resumes) |
           provider done            |                  |
       +-------------------+ <------+                  |
       v                                               |
   +------+   stream error   +--------+                |
   | done |<---------------->| error  |  (red banner + |
   +------+                  +--------+   status-bar)  |
      ^   user cancels (Stop/Esc)                      |
      +-- +----------------+                           |
          |   cancelled    | (muted banner)            |
          +----------------+                           |
                                                       |
                (any terminal state) ------------------+

Parallel — EditLockMachine (decorates editor region only)

   +----------+   write_note / edit_note starts    +--------+
   | unlocked |----------------------------------->| locked |
   +----------+<-----------------------------------+--------+
                  3s highlight fade || release-on-failure
                  (F18 ships the fade + range; this feature
                   only owns the `data-visual-state` token)
```

- The diagram encodes the `StreamEvent` transitions fixed in [Architecture §4 Key Contracts](../../../../architecture/architecture.md#4-key-contracts): `token` → `streaming`, `tool_call` → `tool-running`, `tool_confirmation` → `awaiting-confirmation`, `tool_result` → `tool-running` or back to `streaming`, `done` → `done`, `error` → `error`, user-abort → `cancelled`.
- The edit-lock parallel state is emitted by F18 but decorated through the same `VisualStateMachine` so its `data-visual-state="edit-locked"` attribute sits on the editor host, not on any chat region, keeping the two machines independent ([Architecture §6 State Ownership](../../../../architecture/architecture.md#6-state-ownership)).
- Reduced-motion: the state graph is identical; only the CSS transitions that paint the state boundaries (streaming cursor blink, awaiting-confirmation glow, edit-locked fade) are suppressed under `prefers-reduced-motion: reduce` ([UI Layer — Styling](../../../../standards/tech-stack.md#ui-layer)).

## Event flow

Every event below flows through the shared `VisualStateMachine`; consumers subscribe via a React hook and receive the active `VisualState` plus ARIA hints.

```
provider.stream():
  on token           -> VisualStateMachine.set("streaming")
                      -> data-visual-state="streaming" on tail bubble
                      -> aria-busy="true" + role="status"

  on tool_call start -> VisualStateMachine.set("tool-running", { toolId })
                      -> icon = iconFor(toolId)
                      -> paint [⟳ <toolId>] row via setIcon(icon)
                      -> aria-busy="true"

  on tool_call with requiresConfirmation=true
                     -> VisualStateMachine.set("awaiting-confirmation")
                      -> mount InlineConfirmation (F17 fills content)
                      -> amber palette applied via CSS var --color-orange
                      -> focus moves to first button in dialog (a11y)
                      -> NEVER opens an Obsidian Modal

  on confirmation Deny
                     -> returns a tool-error result to the stream
                     -> VisualStateMachine.set("tool-running") briefly,
                        then back to "streaming" as the loop resumes

  on stream error    -> VisualStateMachine.set("error")
                      -> paint red banner inside MessageList
                      -> Notifications.status("provider", "disconnected")
                      -> aria-live="assertive" on banner

  on cancel (user)   -> VisualStateMachine.set("cancelled")
                      -> paint muted banner "cancelled after N tools"
                      -> aria-live="assertive"

  on done            -> VisualStateMachine.set("idle")
                      -> aria-busy="false"

edit-lock (parallel, driven by F18):
  on write/edit start -> EditLockMachine.set("locked")
                      -> data-visual-state="edit-locked" on editor host
                      -> highlight palette applied (F18 paints decoration)
  on write/edit end   -> EditLockMachine.set("unlocked")
                      -> 3s fade gated by prefers-reduced-motion

teardown (ChatView.onClose / plugin unload):
  VisualStateMachine.dispose()       -> removes all data-visual-state attrs
  Notifications.disposeAll()         -> removes every status-bar entry
                                        registered via status(key, ...)
                                      -> dismisses any open inline modal
                                      -> no dangling listeners
```

- The single `AbortController` owned by `AgentRunner` in [F07](../chat-streaming-stop/feature.md) is the authority for cancel; this feature only reacts to the resulting terminal event and paints the muted banner ([Architecture §5.6 Cancellation](../../../../architecture/architecture.md#56-cancellation)).
- Error events simultaneously fan out to the `error` banner inside `MessageList` and to `Notifications.status("provider", "…")`; the inline `blockingError` modal is reserved for cases that prevent further interaction (e.g. first-run wizard failures) per [Architecture §7 Error Handling Strategy](../../../../architecture/architecture.md#7-error-handling-strategy).
- Teardown is symmetric with mount per [Code style — React 18](../../../../standards/code-style.md#react-18) and registered via `Plugin.register` per [Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns).

## Component mapping

| Concern | Module / primitive | Standards anchor |
|---|---|---|
| Shared `VisualStateMachine` (idle / streaming / tool-running / awaiting-confirmation / error / cancelled / edit-locked) | React context + reducer exported from this feature; writes `data-visual-state="<name>"` on the active region | [Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views), [Code style — React 18](../../../../standards/code-style.md#react-18) |
| `iconFor(toolId)` registry resolves built-in read / write / search / edit families and `mcp.*` generic | Pure TS map + `setIcon(el, name)` at paint time | [Platform APIs — setIcon](../../../../standards/tech-stack.md#platform-apis), [UI Layer — Icons](../../../../standards/tech-stack.md#ui-layer) |
| MCP placeholder `<server-name>` label slot | Consumer-supplied lookup `(serverId) => string \| undefined` passed to `iconFor` | [Architecture §4 Key Contracts](../../../../architecture/architecture.md#4-key-contracts) |
| `Notifications.notice(message)` — transient success / info | Obsidian `new Notice(message)` | [Platform APIs — Notice](../../../../standards/tech-stack.md#platform-apis), [Architecture §7 Error Handling Strategy](../../../../architecture/architecture.md#7-error-handling-strategy) |
| `Notifications.status(key, message)` — persistent connectivity / indexing | Obsidian `addStatusBarItem()` with keyed replace-in-place and `Plugin.register(() => el.remove())` | [Platform APIs — addStatusBarItem](../../../../standards/tech-stack.md#platform-apis), [Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns), [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) |
| `Notifications.blockingError(content)` — inline modal in `InlineDialog` | React portal into the `InlineDialog` region scaffolded by [F04](../chat-sidebar-view/feature.md); NEVER `new Modal(app)` | [Architecture §7 Error Handling Strategy](../../../../architecture/architecture.md#7-error-handling-strategy), [Code style — React 18](../../../../standards/code-style.md#react-18) |
| Tool-confirmation channel (forbidden native-Modal path asserted by unit test) | Routes to `InlineConfirmation` slot from [F04](../chat-sidebar-view/feature.md); vitest spies on `Modal` constructor and fails if invoked | [Code style — Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw), [Code style — Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| State palette tokens (`--color-orange` amber, `--text-error` red, `--text-muted` cancelled, `--text-accent` edit-lock, `--background-modifier-border`, `--background-modifier-error`) | Obsidian CSS variables; no hex / rgb literals | [UI Layer — Styling](../../../../standards/tech-stack.md#ui-layer), [Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) |
| Reduced-motion gate | `@media (prefers-reduced-motion: reduce)` rules disable pulse / spin / fade keyframes while keeping `data-visual-state` updates | [UI Layer — Styling](../../../../standards/tech-stack.md#ui-layer), [Best practices — Core Principles](../../../../standards/best-practices.md#core-principles) |
| ARIA semantics (`role="status"`, `aria-busy`, `aria-live="assertive"` for error/cancel, `aria-live="polite"` for state transitions) | Native ARIA on the active region; no `aria-hidden` overrides | [UI Layer](../../../../standards/tech-stack.md#ui-layer), [Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) |
| Mount / unmount symmetry (teardown of state subscriptions, status-bar entries, inline modal) | `useEffect` cleanup + `Plugin.register` | [Code style — React 18](../../../../standards/code-style.md#react-18), [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) |

## Back-link

- Feature spec: [./feature.md](./feature.md)
