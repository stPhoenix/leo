# F37 — Multi-thread management · UI

Back-link: [feature.md](./feature.md).

UI layer, Obsidian + React conventions, and platform-API wiring for this spec come from [tech-stack — UI Layer](../../../../standards/tech-stack.md#ui-layer), [tech-stack — Platform APIs](../../../../standards/tech-stack.md#platform-apis), [architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views), [architecture §3.2](../../../../architecture/architecture.md#32-agent-layer), [architecture §6](../../../../architecture/architecture.md#6-state-ownership), [architecture §9](../../../../architecture/architecture.md#9-project-file-layout-proposed). Every region mounts inside the [F04 chat-sidebar-view](../chat-sidebar-view/feature.md) `HeaderBar` / `Notice` regions; no new top-level leaf is created.

## Layout

### 1. HeaderBar — current thread title + dropdown affordance (width ≥ 280px)

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|
+-----------------------------------------------------+
| [leo] Leo                                  [-][o][x]|   <- Obsidian leaf chrome
+-----------------------------------------------------+
| [#] Draft: April research notes       [v]  [⚙][⋯]   |   <- HeaderBar (F04)
|     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^   ^                |
|     role="button"                    role="button"  |
|     aria-label="Rename thread"       aria-haspopup="menu"
|     title = thread.metadata.title    aria-expanded="false"
|                                      aria-controls="leo-thread-list"
+-----------------------------------------------------+
| ContextIndicator · MessageList · Composer           |   (F09 / F05 / F06)
+-----------------------------------------------------+
```

- Title text = `thread.metadata.title` (default `"New thread"`), truncates mid-word with native `title=` tooltip on overflow.
- `[v]` chevron = [`setIcon('chevron-down')`](../../../../standards/tech-stack.md#platform-apis); data-open flips with popover state.
- `[⚙]` = skill picker from [F22](../skills-picker-active-skill/feature.md) — unrelated to this slice, kept for alignment.
- `[⋯]` = HeaderBar overflow menu; owns "Rename", "Delete current thread", "New thread" items wired to the same handlers the command palette uses.
- `[#]` = [`setIcon('messages-square')`](../../../../standards/tech-stack.md#platform-apis) thread glyph (Lucide), static; never a state channel.

### 2. Thread-list popover — open (anchored under the chevron)

```
+-----------------------------------------------------+
| [#] Draft: April research notes     [^]  [⚙][⋯]     |   data-open="true"
|                                     |               |
+-------------------------------------+---------------+
                                      |
  +-----------------------------------v-----------+
  | role="listbox"                                 |   id="leo-thread-list"
  | aria-label="Switch thread"                     |
  +------------------------------------------------+
  | (+) New thread                         Ctrl+N  |   role="option" data-action="create"
  +------------------------------------------------+
  | ✓  Draft: April research notes                 |   role="option" aria-selected="true"
  |    just now                            [⋯]     |   data-active="true"   unread=0
  +------------------------------------------------+
  | •  Debugging the indexer                       |   • = unread indicator
  |    5 min ago                           [⋯]     |   aria-label="… (unread)"
  +------------------------------------------------+
  |    Weekend reading list                        |
  |    yesterday                           [⋯]     |
  +------------------------------------------------+
  |    Onboarding notes                            |
  |    3 days ago                          [⋯]     |
  +------------------------------------------------+
  |                              [Esc = close]     |
  +------------------------------------------------+
```

- Rows sorted by `updatedAt` desc per AC-1 ([feature.md](./feature.md)); empty list impossible (auto-create guarantees one row) per AC-5.
- Active row prefixed with `✓`, `aria-selected="true"`, `data-active="true"`; only one active at a time.
- Unread indicator `•` renders when the thread has messages newer than the in-memory read-cursor of that thread (F11 queue hands us the cursor); never color-only — always the `•` glyph + visually-hidden `" (unread)"` text.
- Relative timestamp = Obsidian's `moment().fromNow()` formatter (`just now`, `5 min ago`, `yesterday`, `3 days ago`), refreshed on open.
- `[⋯]` per-row = Obsidian [`Menu`](../../../../standards/tech-stack.md#platform-apis) with `Rename`, `Delete`. Menu actions never swallow the row click.
- Popover width ≥ badge width, ≤ 420 px, max-height 60vh with scroll; z-index = `--leo-z-inline-dialog` ([F04 z-tokens](../chat-sidebar-view/ui.md)).

### 3. Inline rename — title click (or Enter while focused)

```
+-----------------------------------------------------+
| [#] [ Draft: April research notes________________] | [v]  [⚙][⋯]
|     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^   |
|     <textarea rows=1>                                |  auto-grow off
|     role="textbox" aria-label="Thread title"         |  aria-busy toggles on save
|     spellcheck="true"  maxLength=120                 |
|                                                      |
|  Enter = save · Esc = cancel · blur = save           |  microcopy hidden from DOM;
|                                                      |  shown as Obsidian tooltip.
+-----------------------------------------------------+
```

- Single-row `<textarea>` (same primitive as [F06 composer](../chat-composer-input/feature.md), no new component) with `rows=1` and `resize: none`; caret starts at end of current title.
- While `state = saving`, the textarea is `readonly` + `aria-busy="true"`; no spinner (reduced-motion invariant), only the accent-ring pulse declared in [F13](../ui-visual-states-notifications/feature.md).
- Empty / whitespace-only commit reverts to previous title and emits no `thread.rename` log.

### 4. Delete confirmation Notice + Undo

```
Obsidian bottom-right Notice stack (Obsidian-owned z: top)
+-----------------------------------------------------+
|  Thread "Debugging the indexer" deleted.   [Undo]   |   <- Notice
|                                            10s      |      role="status"
+-----------------------------------------------------+
                                             ^
                    [Undo] = <button> inside Notice body;
                    setIcon('rotate-ccw') + "Undo" text;
                    keyboard-reachable via Notice focus trap
                    (Obsidian tabs in on Tab from HeaderBar).
```

- Notice duration 10 s; reduced-motion: no fade, only `opacity: 1 → 0` swap at the end ([NFR-USE-07](../../context.md#nfr-use-07)).
- Dismissing the Notice before `[Undo]` fires does NOT undo — it flushes (mirrors Obsidian's native "Note moved to trash" Notice).
- Second delete fired while a Notice is live queues a second Notice; Undo always pertains to its own thread id (ids are captured at fire time, not read from global state).

### 5. Empty state after delete (only when all threads gone but before auto-create lands)

The auto-create in AC-5 runs synchronously inside `delete()`, so this state is visually unreachable in the happy path. The empty-safety fallback is spec'd here for the Undo race (user clicks Undo while the auto-created successor is still cold):

```
+-----------------------------------------------------+
| [#] New thread                       [v]  [⚙][⋯]    |   auto-created placeholder
+-----------------------------------------------------+
| ContextIndicator (none)                             |
+-----------------------------------------------------+
|                                                     |
|   role="log" aria-live="polite"                     |
|                                                     |
|   Start a new conversation.                         |   static hint, no icon;
|   Type a message below or press Ctrl/Cmd+P →        |   not an error state.
|   "Leo: New thread" for another.                    |
|                                                     |
+-----------------------------------------------------+
| ComposerInput (focused)                             |
+-----------------------------------------------------+
```

If Undo fires while this placeholder is still the active thread, `ThreadsStore.restore(id)` re-switches to the restored thread and the placeholder stays on disk (it already satisfies the invariant "at least one thread exists"). The placeholder is just another row in the popover from then on.

## State machine

Three machines run side by side: `ThreadListPopoverMachine`, `RenameMachine`, `DeleteMachine`. All three live in React state inside `HeaderBar`, not in the store.

### 1. Thread-list popover

```
                  click chevron / Ctrl+Alt+T
                     / overflow-menu "Switch thread"
            +---------------+
            |     closed    |<---------------------------+
            +-------+-------+                            |
                    |                                    |
                    v                                    |
            +---------------+  click outside / Esc /     |
            |     open      |  switch completes / delete |
            +-------+-------+----------------------------+
                    |    ^
   row click /      |    |  arrow keys
   Enter on row     |    |  re-fire (no state change,
                    v    |  focus ring moves)
            +---------------+
            |   selecting   |
            +-------+-------+
                    |
                    |  ThreadsStore.switch(id) resolves
                    |  → ConversationStore active id swap
                    v
               closed
```

Invariants: `selecting` is momentary — the popover closes as soon as the active swap promise resolves; no empty "loading" state inside the popover (swap is synchronous against in-memory state, persistence is background-flushed per F14). Reduced-motion: popover open/close is instant, no slide.

### 2. Inline rename

```
      click title / F2 / Enter on focused title
   +-------+
   |  idle |<-----------------------------+
   +---+---+                              |
       |                                  |
       v                                  |
   +---------+  Enter / blur (non-empty)  |
   | editing |--------+                   |
   +----+----+        |                   |
        |             v                   |
        |       +---------+               |
        |       |  saving |--- resolve ---+
        |       +---------+               |
        |                                 |
        |  Esc / blur (empty)             |
        +---------------------------------+
                    (no save)
```

`saving` renders the textarea `readonly` + `aria-busy="true"`; duration is one `ConversationStore.mutate` debounce window. Failure path: `saving → idle` with the textarea restored to the pre-edit value + a `Notice` via [F13](../ui-visual-states-notifications/feature.md) — handled by the store, not a new UI state.

### 3. Delete

```
     overflow "Delete" / "Leo: Delete current thread"
   +-------+
   |  idle |<-------------------+----------------------+
   +---+---+                    |                      |
       |                        |                      |
       v                        |                      |
   +---------+                  |                      |
   | trashed |                  |                      |
   +----+----+                  |                      |
        |                       |                      |
        |  Undo clicked         |  10s elapsed /       |
        |  within 10s           |  Notice dismissed    |
        v                       v                      |
   +---------+           +----------+                  |
   | undone  |-----------| flushed  |                  |
   +----+----+           +-----+----+                  |
        |                      |                       |
        | re-switch active     | hard-delete file      |
        +----------------------+-----------------------+
                               v
                              idle
```

`trashed` = file moved to `.leo/conversations/.trash/<id>.json`, Notice live. `undone` = `ThreadsStore.restore(id)` moved the file back + re-switched active id. `flushed` = `.trash/<id>.json` removed from disk. Exactly one terminal transition per fire; the id-capture rule above guarantees no cross-talk between stacked Notices.

## Event flow

### 1. "Leo: New thread" command → creates thread + switches

1. User triggers `Cmd/Ctrl+P → "Leo: New thread"`. The command is registered via [`Plugin.addCommand`](../../../../standards/tech-stack.md#platform-apis) in `Plugin.onload` with no default hotkey per [FR-UI-04](../../context.md#fr-ui-04).
2. Callback calls `ThreadsStore.create()` — generates fresh id, writes `.leo/conversations/<id>.json` with `schemaVersion: 1`, `metadata.title = "New thread"`, `metadata.skillId = "general"`, `metadata.allowedTools = []`, empty `messages` (AC-2).
3. `ThreadsStore.switch(id)` runs inline: the previously-active thread's in-memory state is flushed through [F14](../conversation-persistence-v1/feature.md)'s debounced save before the swap; the new id is written to plugin data via [`saveData`](../../../../standards/tech-stack.md#platform-apis); `AgentRunner` rehydrates with the new thread (AC-3).
4. `HeaderBar` re-renders with the new title; `ComposerInput` receives imperative focus via the same focus ref [F04](../chat-sidebar-view/feature.md) uses on mount (keyboard-reachability invariant).
5. `Logger.info("thread.create", { id })` — id only, never title / content ([NFR-LOG-04](../../context.md#nfr-log-04)).

### 2. Click a thread row → switches + loads

1. User opens the popover (chevron click or `Ctrl+Alt+T`), Tab/Arrow-Down to the target row, Enter — or mouse click.
2. Popover transitions `open → selecting` (see state machine 1). `ThreadsStore.switch(id)` runs: F14 flush of outgoing thread → `ConversationStore` active id swap → `AgentRunner` hydrate with the new thread's `messages` + `metadata` (allow-list, `skillId`) before the next `ChatView` render (AC-3).
3. Popover closes; `HeaderBar` title updates; `MessageList` re-renders from the newly hydrated messages; unread dot (if any) on the target row clears on the next open of the popover.
4. `Logger.info("thread.switch", { id })`.

### 3. Click title → inline textarea rename (Enter saves, Esc cancels)

1. User clicks the title region OR focuses it via Tab and hits Enter/F2. `RenameMachine: idle → editing`; the `<span>` swaps to a single-row `<textarea>` primitive reused from [F06](../chat-composer-input/feature.md); caret at end.
2. User types. On Enter (without Shift) or blur with a non-empty, non-whitespace value: `editing → saving`; textarea is `readonly` + `aria-busy="true"`.
3. `ThreadsStore.rename(id, name)` calls `ConversationStore.mutate(id, t => { t.metadata.title = name })` so the rename persists through [F14](../conversation-persistence-v1/feature.md) into `metadata.title` (AC-4).
4. Mutate resolves → `saving → idle`; textarea swaps back to `<span>`; `Logger.info("thread.rename", { id })`.
5. Esc OR empty-/whitespace-only commit → `editing → idle` with no save, no log. Focus returns to the title's `<span>` so Tab order is preserved.

### 4. Delete → trashed + Notice with Undo; Undo restores; after 10s flushes

1. User triggers delete via the HeaderBar `[⋯]` overflow → "Delete current thread", the per-row `[⋯]` → "Delete", or `Cmd/Ctrl+P → "Leo: Delete current thread"` (all share the same handler).
2. `ThreadsStore.delete(id)` runs: `DeleteMachine: idle → trashed`; the on-disk file is moved to `.leo/conversations/.trash/<id>.json` via the `VaultAdapter` seam ([architecture §3.4](../../../../architecture/architecture.md#34-adapters)); if this was the active thread, `ThreadsStore.switch(next)` runs where `next` = most-recently-updated remaining thread, or an auto-created `"New thread"` if the trashed one was the last (AC-5).
3. An Obsidian [`Notice`](../../../../standards/tech-stack.md#platform-apis) is shown with body `Thread "<title>" deleted.` and an inline `[Undo]` button; duration 10 s; the captured id lives in the button's closure, not in a shared cell.
4. `Logger.info("thread.delete", { id })`.
5. User clicks `[Undo]` within 10 s → `ThreadsStore.restore(id)` moves `.trash/<id>.json` back to `.leo/conversations/<id>.json`, re-switches active id to it (re-firing the same swap path as event flow 2); `DeleteMachine: trashed → undone`; `Logger.info("thread.delete.undo", { id })`. The Notice auto-dismisses.
6. User does nothing for 10 s (or dismisses the Notice) → the `configurable window` timer ([code-style — Async & Concurrency](../../../../standards/code-style.md#async--concurrency)) fires `ThreadsStore.flush(id)` → hard-delete `.trash/<id>.json`; `DeleteMachine: trashed → flushed`. No extra log event per NFR-LOG-04 (it's the tail of the original `thread.delete`).

### 5. Unread indicator lifecycle (cross-cutting)

1. [F11 chat-message-queue](../chat-message-queue/feature.md) writes the per-thread read-cursor on each assistant message render in the active thread.
2. When the popover opens, each row reads its thread's cursor vs. its latest `updatedAt` and renders `•` when behind. No polling; popover computes on open only.
3. Clicking (switching to) a thread clears its dot on the next open.

## Component mapping

| UI block | Obsidian / React component | Standards reference |
|---|---|---|
| Thread-list popover anchor (chevron + overflow actions) | Obsidian [`Menu`](../../../../standards/tech-stack.md#platform-apis) for the `[⋯]` per-row menu + the HeaderBar overflow; React-rendered listbox (`role="listbox"`, arrow/Esc/Enter) for the main popover (Menu doesn't give us aria-selected state) | [Platform APIs](../../../../standards/tech-stack.md#platform-apis); [architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) |
| Thread-list popover row | React `<li role="option" aria-selected={…} data-active={…}>` with checkmark glyph + title + timestamp + `[⋯]` button | [architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) |
| Active-row checkmark | [`setIcon('check')`](../../../../standards/tech-stack.md#platform-apis) — Lucide glyph, painted on mount + on `aria-selected` change | [UI Layer → Icons](../../../../standards/tech-stack.md#ui-layer) |
| Unread indicator `•` | Plain CSS bullet `<span aria-label=" (unread)" aria-hidden="false">•</span>`; also a visually-hidden `" (unread)"` for screen readers so color isn't the sole channel ([NFR-USE-11](../../context.md#nfr-use-11)) | [Code style → Styling](../../../../standards/code-style.md#styling-tailwind--obsidian) |
| Relative timestamp | Obsidian-bundled `moment().fromNow()` off `thread.updatedAt`; computed on popover open, no ticker | [UI Layer](../../../../standards/tech-stack.md#ui-layer) |
| New-thread row `[+]` | Row with [`setIcon('plus')`](../../../../standards/tech-stack.md#platform-apis) + "New thread" label; Enter/click invokes the same handler as the command palette entry | [Platform APIs](../../../../standards/tech-stack.md#platform-apis) |
| Delete per-row action | Obsidian [`Menu`](../../../../standards/tech-stack.md#platform-apis) item with [`setIcon('trash')`](../../../../standards/tech-stack.md#platform-apis) + "Delete" label; invokes `ThreadsStore.delete(id)` | [Platform APIs](../../../../standards/tech-stack.md#platform-apis) |
| Rename per-row action | Obsidian [`Menu`](../../../../standards/tech-stack.md#platform-apis) item with [`setIcon('pencil')`](../../../../standards/tech-stack.md#platform-apis) + "Rename"; invokes the same `RenameMachine` used by title click | [Platform APIs](../../../../standards/tech-stack.md#platform-apis) |
| Inline rename textarea | Same primitive as [F06 composer textarea](../chat-composer-input/feature.md) reused with `rows=1`, `resize: none`, `maxLength=120`, `aria-label="Thread title"`; React handles Enter/Esc/blur; no new component introduced | [UI Layer → Framework](../../../../standards/tech-stack.md#ui-layer); [Code style → React 18](../../../../standards/code-style.md#react-18) |
| Delete confirmation Notice | Obsidian [`Notice`](../../../../standards/tech-stack.md#platform-apis) with a DOM-injected `<button>` child for `[Undo]`; captured id lives in the button's closure; 10 s duration | [Platform APIs](../../../../standards/tech-stack.md#platform-apis); [tech-stack — Platform APIs](../../../../standards/tech-stack.md#platform-apis) |
| Notice Undo button icon | [`setIcon('rotate-ccw')`](../../../../standards/tech-stack.md#platform-apis) (Lucide) | [UI Layer → Icons](../../../../standards/tech-stack.md#ui-layer) |
| Command palette entries | `Plugin.addCommand({ id: "leo-new-thread", name: "Leo: New thread", callback })` and `{ id: "leo-delete-thread", name: "Leo: Delete current thread", callback }` — no default hotkeys per [FR-UI-04](../../context.md#fr-ui-04) | [Platform APIs → `Plugin.addCommand`](../../../../standards/tech-stack.md#platform-apis); [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| Active-thread id persistence | `Plugin.loadData` / `saveData` per [architecture §6](../../../../architecture/architecture.md#6-state-ownership); fallback to most-recently-updated thread or auto-created `"New thread"` on missing id (AC-6) | [Platform APIs](../../../../standards/tech-stack.md#platform-apis); [architecture §6](../../../../architecture/architecture.md#6-state-ownership) |
| Popover focus trap | Native DOM — first focus lands on the active row; Tab cycles within the listbox; Esc closes + returns focus to the chevron that opened it (invoker ref) | [architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) |
| Reduced-motion handling | Popover uses `display: block / none` (no transition) when `prefers-reduced-motion: reduce`; Notice fade suppressed via the same media query per [F13](../ui-visual-states-notifications/feature.md) | [Code style → Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) |
| Z-index | Popover = `--leo-z-inline-dialog` (shares with F04's InlineDialog slot); Notice stacking left to Obsidian | [architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) |
| Keyboard shortcuts | Default: none (user binds via Hotkeys UI); implicit: `Enter` on focused title = rename, `F2` on focused title = rename, `Esc` = cancel rename / close popover, `Enter` on row = switch | [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| Logger events | `thread.create / thread.switch / thread.rename / thread.delete / thread.delete.undo` with `{ id, count? }` — never title, never messages above `debug` | [NFR-LOG-04](../../context.md#nfr-log-04); [Code style → Logging](../../../../standards/code-style.md#logging) |
| Tests (popover roles, active swap, rename persist, Undo restore, auto-create) | Vitest + jsdom per [F04 testing baseline](../chat-sidebar-view/ui.md) | [Testing → Unit](../../../../standards/tech-stack.md#testing) |

Accessibility invariants (inherit [F04](../chat-sidebar-view/feature.md); additions for this slice):

- Every new affordance (chevron, row, row `[⋯]`, Undo button) is Tab/Shift-Tab reachable in visual order; arrow keys move focus within the popover listbox; `Esc` cancels rename and closes popover, returning focus to the invoker.
- `role="listbox"` + `role="option"` on the popover; exactly one `aria-selected="true"` at a time per [WAI-ARIA Authoring Practices — Listbox](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/).
- Unread `•` is paired with visually-hidden `" (unread)"` text so screen readers and color-blind users get the same signal ([NFR-USE-11](../../context.md#nfr-use-11)).
- `prefers-reduced-motion: reduce` suppresses popover fade and Notice slide; state changes still apply, without animation ([NFR-USE-07](../../context.md#nfr-use-07)).
- Rename textarea and Notice Undo button render the default focus ring (`var(--interactive-accent)`, ≥ 2 px) inherited from [F04](../chat-sidebar-view/ui.md); never removed.

## Back-link

[← feature.md](./feature.md)
