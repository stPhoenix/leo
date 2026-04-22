# F30 — Indexer UI controls · UI

## Layout

All wireframes use pure ASCII box-drawing. Every colour lands through Obsidian CSS variables (`--text-muted`, `--background-modifier-border`, `--interactive-accent`, `--color-orange`, `--color-green`) per [Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian); zero colour literals appear in any surface this feature owns.

### Wireframe 1 — Status-bar entry, draining (full label)

```
 0         10        20        30        40        50        60        70
 |---------|---------|---------|---------|---------|---------|---------|
+--------------------------------------------------------------------------+
| (...other plugin status items...)                                        |
|                                   [db] Indexing — 42 files left (daily/  |
|                                   2026-04-19.md)                         |
+--------------------------------------------------------------------------+
  ^                                  ^           ^             ^
  |                                  |           |             |
  |                                  |           |             basename of current path
  |                                  |           |             rendered via `path.basename`
  |                                  |           |             (no above-`debug` logging)
  |                                  |           count dequeued from F27's
  |                                  |           `indexer.drain.tick` payload
  |                                  `setIcon("database")` glyph per
  |                                   FR-IDX-14; painted once on mount,
  |                                   never re-painted per tick.
  Obsidian-native status-bar strip (bottom of window), reserved by
  `Plugin.addStatusBarItem()` per [Platform APIs](../../../../standards/tech-stack.md#platform-apis).
```

Root element: `<div class="leo-indexer-statusbar" role="status" aria-live="polite" aria-atomic="true">` per [FR-IDX-14](../../context.md#fr-idx-14). Content layout is icon + thin-space + label; the label is a single `<span>` whose `textContent` mutates on each frame-coalesced tick so the live-region announces the latest files-left value (assistive-tech throttled by Obsidian to polite-announce cadence). Width discipline: the default label is `Indexing — <n> files left (<basename>)`; when the status-bar available width (measured via `ResizeObserver` on the item's `containerEl`) drops below 140 px, the render collapses to `Indexing — <n>` and the full label is mirrored into the `title` attribute so hover still surfaces it (addresses the open question on status-bar width). No transitions run when `prefers-reduced-motion: reduce` is set ([Code style — Styling](../../../../standards/code-style.md#styling-tailwind--obsidian)).

### Wireframe 2 — Status-bar entry, idle (DOM-removed)

```
 0         10        20        30        40        50        60        70
 |---------|---------|---------|---------|---------|---------|---------|
+--------------------------------------------------------------------------+
| (...other plugin status items...)                                        |
|                                                                          |
+--------------------------------------------------------------------------+
  ^
  |
  The Leo status-bar item is *removed from the DOM* between
  `indexer.drain.complete` and the next `indexer.drain.start`
  (per AC1 in feature.md — idle means no node, not an empty node).
```

Invariants:

- There is no "Index ready" literal glyph at idle: AC1 in [feature.md](./feature.md) says the node DOM-removes on `drain.complete`. We satisfy FR-IDX-14 by re-creating the node via `Plugin.addStatusBarItem()` on the next `drain.start`. If a transient readiness hint is desirable on first-index completion, it routes through a one-shot `Notice` and the status-bar stays silent.
- No hover tooltip, no persistent glyph, no click target at idle — the slot belongs to other plugins when Leo is not draining.
- On teardown (`Plugin.onunload`), any live node is auto-disposed because `addStatusBarItem()` registers the element against the Plugin lifecycle per [Code style — Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns).

### Wireframe 3 — Reindex-on-model-switch confirmation (native Modal allowed here)

This is a user-triggered settings flow, so a native `Modal` is acceptable per the FR-UI-08 carve-out (the FR-UI-08 prohibition targets tool-confirmation dialogs only — settings and user-initiated flows may use native modals). The modal is cited below with the exact carve-out link.

```
 0         10        20        30        40        50        60        70
 |---------|---------|---------|---------|---------|---------|---------|
+--------------------------------------------------------------------------+
|                          Obsidian modal backdrop                         |
|                                                                          |
|        +----------------------------------------------------+            |
|        | [db] Re-index vault?                          [x]  |            |
|        |----------------------------------------------------|            |
|        |                                                    |            |
|        |  The embedding model changed from                  |            |
|        |  `nomic-embed-text-v1.5` to                        |            |
|        |  `bge-small-en-v1.5`. The existing index           |            |
|        |  cannot be reused.                                 |            |
|        |                                                    |            |
|        |  Choose one:                                       |            |
|        |                                                    |            |
|        |  [  Now  ]  [  Later  ]  [ Revert model ]          |            |
|        |  primary    secondary    secondary                 |            |
|        |                                                    |            |
|        +----------------------------------------------------+            |
|                                                                          |
+--------------------------------------------------------------------------+
  ^                   ^               ^              ^
  |                   |               |              |
  `Modal` per         title with      three Mod.buttonContainer
  [Platform APIs]     setIcon("db")   buttons; tab order is Now →
  ( Obsidian-native                   Later → Revert; Esc ≡ Later
  modal, user-triggered               (non-destructive default per
  settings flow — FR-UI-08            AC3 in [feature.md](./feature.md)).
  carve-out cited in
  component mapping )
```

Focus contract:

- On mount, focus is placed on `[ Now ]`; the Modal traps Tab/Shift-Tab across the three buttons per Obsidian's native `Modal.open()` behaviour ([Platform APIs — Modal](../../../../standards/tech-stack.md#platform-apis)).
- Esc closes the modal ≡ `Later` (defers; index untouched), matching AC3 in [feature.md](./feature.md).
- Clicking the backdrop or the `[x]` corner triggers `Later` (not `Revert`) — destructive / rollback paths must be explicit button clicks.
- `Now` disables itself for the duration of the re-enqueue pass and re-enables on `indexer.drain.start` fan-out, preventing double-dispatch within the modal (complements the in-flight command-handler debounce flagged in the open questions).
- `Revert` writes the previous `{model, dim}` back through F03's settings persistence per AC3 in [feature.md](./feature.md); the settings UI subscriber picks up the change and redraws; no indexer work runs.

Every colour — primary vs secondary button tint, border, text — lands through Obsidian CSS variables (`--interactive-accent` for `[ Now ]`, `--background-modifier-border` for the frame, `--text-normal` / `--text-muted` for the copy). No colour literals.

### Wireframe 4 — Empty ChatView with "Index vault" CTA card

Mounts inside the [F04](../chat-sidebar-view/feature.md) ChatView `MessageList` empty-thread region, reusing the F04 empty-state pattern (same region that shows "(empty — messages mount here via F05)" in F04's default layout).

```
 0         10        20        30        40
 |---------|---------|---------|---------|
+------------------------------------------------+
| [leo] Leo                  [-] [o] [x]         |   <- F04 HeaderBar
+------------------------------------------------+
| ContextIndicator                               |
|  note: (none)  range: --  selection: --        |
+------------------------------------------------+
|                                                |
|   MessageList                                  |
|   role="log"  aria-live="polite"               |
|                                                |
|   +----------------------------------------+   |
|   |                                        |   |
|   |             [db]                       |   |   <- card header
|   |                                        |   |
|   |   Your vault isn't indexed yet         |   |   <- one-line prompt
|   |                                        |   |
|   |   Leo uses a local index of your       |   |   <- supporting copy
|   |   markdown to answer questions.        |   |      (muted)
|   |                                        |   |
|   |   [  Index vault  ]                    |   |   <- primary CTA
|   |                                        |   |
|   +----------------------------------------+   |
|                                                |
|   (other F04 empty-state hints sit *below*     |
|    this card — stacking order confirmed        |
|    with F04 in the Open questions)             |
|                                                |
+------------------------------------------------+
| InlineConfirmation (hidden)                    |
+------------------------------------------------+
| InlineDialog (hidden)                          |
+------------------------------------------------+
| ComposerInput: [ type a message ... ] [send]   |
+------------------------------------------------+
```

Root: `<section role="region" aria-labelledby="leo-idx-cta-title" class="leo-indexer-empty-cta">`. Title: `<h3 id="leo-idx-cta-title">Your vault isn't indexed yet</h3>`. CTA button: `<button type="button" class="mod-cta">Index vault</button>` painted with no icon (card icon above is enough). The card is keyboard reachable via the normal MessageList Tab sequence; the CTA button owns the natural focus-next after the F04 header. The card unmounts on first `indexer.drain.complete` and never mounts when an index already exists (AC4 in [feature.md](./feature.md)).

## State machine

Two machines run side-by-side: the **StatusBarMachine** tracks drain visibility, and the **EmptyStateMachine** tracks the no-index CTA lifecycle. Both honour `prefers-reduced-motion: reduce` by suppressing opacity transitions on mount / unmount.

### StatusBarMachine

Plain-text ASCII diagram (state = label, arrow = event):

```
                    +--------+
                    |        |
   drain.complete   |  idle  |   drain.start
       <----------+ |        | +---------->
       |             +--------+             |
       |                 ^                  v
       |                 |             +----------+
       |     user opens  |             |          |
       |     command-palette / CTA --> | draining |
       |     button   (triggers        |          |
       |     reindex enqueue &         +----------+
       |     drain.start)              |  ^     |
       |                               |  |     | provider
       |                               |  |     | unreachable
       |                               |  |     v
       |                               |  |   +--------+
       |                               |  +---+ paused |
       |                               |      |        |
       |                               |      +--------+
       |                               |        |
       |                               |        | provider
       |                               |        | reachable
       |                               v        v
       +---------------------------- (back to draining or idle)
```

States:

- `idle` — DOM node removed; no listener updates; the `title` attribute from the collapsed variant is cleared. Entry action: unregister the `ResizeObserver`, cancel any pending `rAF` callback, emit `indexer.ui.status-bar-throttled` with `{ticksCoalesced:0, drained:true}` once.
- `draining` — DOM node present; label renders per Wireframe 1; each `indexer.drain.tick` schedules a single `requestAnimationFrame` render, coalescing multiple ticks landing in the same frame (AC1 + AC5 in [feature.md](./feature.md)). Exits on `indexer.drain.complete` (→ `idle`) or [F02](../provider-lmstudio-core/feature.md) unreachable signal (→ `paused`).
- `paused` — DOM node stays mounted but the label swaps to `Indexing — paused (LM Studio unreachable)`; glyph swaps to `setIcon("pause")`; `aria-live` still polite. Per [Architecture §7 Error Handling Strategy](../../../../architecture/architecture.md#7-error-handling-strategy), provider unreachable pauses indexing; this feature surfaces that state rather than owning it. Returns to `draining` when F02 reports reachable.

The transition from any state back to `idle` on `drain.complete` is the terminal invariant that also unmounts the empty-state CTA if it was still mounted.

### EmptyStateMachine

```
    +----------+       IndexHeader absent       +-----------+
    |          | +----------------------------> |           |
    | no-index |    OR first-run flag set       | indexing  |
    |          |                                |           |
    +----------+                                +-----------+
         ^                                            |
         |                                            | drain.complete (first)
         |                                            v
         |                                      +-----------+
         |  header.rebuilt / header.deleted     |           |
         +------------------------------------+ |  ready    |
              (F29 / F30 reindex paths)         |           |
                                                +-----------+
```

States:

- `no-index` — CTA card mounted in the MessageList empty-thread region (Wireframe 4). Entered on mount whenever [F27](../vault-indexer-dirty-queue/feature.md)'s `IndexHeader` is absent OR the first-run flag from [F03](../settings-tab-scaffold/feature.md) is set.
- `indexing` — CTA card remains mounted with a thin helper line under the button — `(working on it — see status bar)` — so users who kicked off indexing from the card get in-chat feedback as well. Status bar still owns the per-file progress; the card does not duplicate counts. Transition triggered by the first `indexer.drain.start` after the CTA click.
- `ready` — CTA card auto-unmounts on the first `indexer.drain.complete` (AC4 in [feature.md](./feature.md)). Stays absent for the rest of the session; re-enters `no-index` only if header vanishes (F29 corruption rebuild) or the user invokes the re-index command, per the `header.rebuilt / header.deleted` return arrow.

## Event flow

Every flow is listener-driven; nothing polls. All subscriptions are registered via `Plugin.registerEvent` / `Plugin.registerDomEvent` / `useEffect` cleanup per [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules).

### A. F27 drain progress → status-bar label update (rAF-throttled)

1. [F27](../vault-indexer-dirty-queue/feature.md) emits `indexer.drain.start` with `{totalPending:n}` on the shared event bus.
2. StatusBarController lazily creates the DOM node via `Plugin.addStatusBarItem()`, paints `setIcon("database")` once, and sets the initial label `Indexing — n files left` (no current path yet).
3. For each subsequent `indexer.drain.tick` event `{remaining, currentPath}`, the controller stores the latest payload in a mutable ref and, if no `rAF` is pending, schedules exactly one via `requestAnimationFrame(render)` ([UI Layer](../../../../standards/tech-stack.md#ui-layer)). Multiple ticks arriving in the same frame all land on the same `rAF` and coalesce to one paint; the coalesce counter feeds the `indexer.ui.status-bar-throttled` structured event emitted on every 1000th tick (or once on `drain.complete`, whichever comes first) via the [F01 Logger](../plugin-bootstrap-logging/feature.md). No file paths logged above `debug` per [Code style — Logging](../../../../standards/code-style.md#logging).
4. Inside `render()`, `textContent` is updated on the single `<span>` child (not `innerHTML`) and a `ResizeObserver` on the item's `containerEl` picks the full vs collapsed label variant.
5. On `indexer.drain.complete`, the controller calls `statusBarItem.remove()` (Obsidian-API seam equivalent to `detach()`), cancels the pending `rAF`, disconnects the `ResizeObserver`, and logs a terminal `indexer.ui.status-bar-throttled` summary.

### B. Command palette → "Leo: Re-index vault"

1. User opens the palette (Cmd/Ctrl-P) and selects `Leo: Re-index vault`. Command registered via `Plugin.addCommand({id: "leo-reindex-vault", name: "Leo: Re-index vault", callback})` per [Code style — Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns). No default hotkey so users can bind through Obsidian's Hotkeys UI (inherited pattern from [F04](../chat-sidebar-view/feature.md)).
2. The callback runs the reindex gate:
   - If an in-flight reindex is already running (bool flag set, cleared on next `drain.complete`), it surfaces an inline `Notice("Reindex already in progress")` and returns. Pins the open-questions "idempotency on rapid double-click" behaviour.
   - Otherwise, surfaces a confirmation `Notice` with two inline actions — `Cancel` / `Re-index now` — per AC2 in [feature.md](./feature.md). Esc ≡ Cancel.
3. On confirm:
   - Clears the `IndexHeader` manifest by delegating to F27's header-write seam (not by direct FS call — this feature owns zero adapter IO per [Best practices — Core Principles](../../../../standards/best-practices.md#core-principles)).
   - Enumerates `app.vault.getMarkdownFiles()` and iterates once, calling F27's `enqueueDirty(path)` for each — every existing markdown file enters the dirty queue.
   - Triggers F27's `queryOnDemand(signal)` path so drain starts immediately rather than waiting on the 30 s idle timer.
   - Emits `indexer.ui.reindex-command` with `{fileCount}` (count only — no paths above `debug`).
4. Flow A now takes over and the status-bar entry mounts on `drain.start`.

### C. Settings change (embedding model) → reindex-on-model-switch confirmation

1. User changes the `embedding model` field in the Provider section of [F03](../settings-tab-scaffold/feature.md). F03 writes the new value through its settings store and emits `settings.embeddingModel.changed` with `{oldModel, oldDim, newModel, newDim}`.
2. The ReindexPromptService subscriber (shared helper — see Open questions) compares `newModel` against the persisted `IndexHeader.model` read from F27. On match (identical model) it is a no-op.
3. On divergence, it opens the Wireframe 3 native `Modal` and emits `indexer.ui.model-switch-prompt` with `{from, to, outcome:"prompted"}`.
4. Branch routing:
   - `Now` → closes the modal and dispatches `app.commands.executeCommandById("leo-reindex-vault")` so the command's confirmation-and-reindex flow runs (deduped path with Flow B step 3). Emits outcome `"now"`.
   - `Later` → closes the modal; no indexer work. The `IndexHeader.model` stays on the previous value so the next vault mutation won't trigger a drain that would mix dimensions. Emits outcome `"later"`.
   - `Revert model` → closes the modal and writes the previous `{model, dim}` back through F03's persistence seam. The F03 subscriber redraws the settings field. Emits outcome `"revert"`.
5. On Esc / backdrop / `[x]` → treated as `Later` (never `Revert` — explicit-only rollback).

### D. No-index detected on ChatView mount → empty CTA rendered → click runs reindex

1. On F04 ChatView `onOpen`, the CTA region subscribes via `useEffect` to two signals: the F03 first-run flag and F27's `IndexHeader` presence flag.
2. If either predicate is true on first render (or becomes true later — e.g. F29 corruption rebuild deletes the header), the card mounts per Wireframe 4, focus is not moved (users may already be typing); the card's `h3` has `aria-describedby` on the supporting copy so screen-readers announce the full context on Tab-in.
3. Click on `Index vault` dispatches `app.commands.executeCommandById("leo-reindex-vault")` — reusing the command path from Flow B so behavior and logging converge. Emits `indexer.ui.empty-state-cta` with `{trigger:"click"}`.
4. Keyboard path: Tab lands on the button; `Enter` / `Space` activate per native button semantics.
5. The card auto-unmounts on the first `indexer.drain.complete` via the EmptyStateMachine transition. On `Plugin.onunload` or `ChatView.onClose`, the subscriptions are cleaned up via `useEffect` return functions and `Plugin.registerEvent` auto-dispose per [Architecture §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules).

### E. Teardown symmetry

On `Plugin.onunload`:

- Status-bar node auto-disposed (Plugin lifecycle).
- `requestAnimationFrame` pending call cancelled via `cancelAnimationFrame(rafId)`.
- `ResizeObserver` `.disconnect()` called.
- Command entry auto-disposed.
- F03 settings subscription unsubscribed.
- F27 event bus subscriptions cleared.
- CTA card `useEffect` cleanup fires unmount.

All of the above register through Plugin / React lifecycle hooks so none requires explicit plumbing in `onunload` itself beyond the standard F01 bootstrap path per [Architecture §5.1 Plugin Startup](../../../../architecture/architecture.md#51-plugin-startup).

## Component mapping

| UI block | Obsidian / React component | Standards reference |
|---|---|---|
| Status-bar item container | [`Plugin.addStatusBarItem()`](../../../../standards/tech-stack.md#platform-apis) returning an `HTMLElement`; auto-disposed on `Plugin.onunload` | [Platform APIs](../../../../standards/tech-stack.md#platform-apis); [Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) |
| Status-bar icon | [`setIcon("database")`](../../../../standards/tech-stack.md#platform-apis) on mount; `setIcon("pause")` on paused state | [UI Layer — Icons](../../../../standards/tech-stack.md#ui-layer) |
| Status-bar label span | `<span>` with `role="status" aria-live="polite" aria-atomic="true"`; `textContent` mutations only | [Code style — Styling](../../../../standards/code-style.md#styling-tailwind--obsidian); [Architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) |
| Status-bar width collapse | `ResizeObserver` on the item's `containerEl`; breakpoint 140 px switches between full label and `Indexing — <n>` with the full text mirrored to `title` | [Best practices — Planning & Design](../../../../standards/best-practices.md#planning--design); [Architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) |
| Tick throttling | `requestAnimationFrame` coalescing; one render per frame regardless of tick burst | [Tech stack — UI Layer](../../../../standards/tech-stack.md#ui-layer); [Code style — Async & Concurrency](../../../../standards/code-style.md#async--concurrency) |
| "Leo: Re-index vault" command | [`Plugin.addCommand({id:"leo-reindex-vault", name:"Leo: Re-index vault", callback})`](../../../../standards/tech-stack.md#platform-apis); no default hotkey so users bind via Obsidian's Hotkeys UI | [Code style — Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns); [Platform APIs](../../../../standards/tech-stack.md#platform-apis) |
| Command inline confirmation | Obsidian [`Notice`](../../../../standards/tech-stack.md#platform-apis) with `Cancel` / `Re-index now` action buttons; Esc ≡ Cancel; in-flight guard returns a second `Notice("Reindex already in progress")` | [Platform APIs](../../../../standards/tech-stack.md#platform-apis); [Architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) |
| Model-switch confirmation | Obsidian native [`Modal`](../../../../standards/tech-stack.md#platform-apis) subclass with `Now` / `Later` / `Revert model` buttons — native Modal is acceptable here because FR-UI-08's prohibition targets tool-confirmation dialogs only; user-triggered settings flows are permitted to use native modals per [FR-UI-08](../../context.md#fr-ui-08) carve-out cross-referenced in [F13 ui-visual-states-notifications](../ui-visual-states-notifications/feature.md) | [Platform APIs](../../../../standards/tech-stack.md#platform-apis); [Architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) |
| Modal focus trap | Native `Modal` Tab/Shift-Tab cycle; initial focus on `[ Now ]`; Esc ≡ `Later` | [Platform APIs — Modal](../../../../standards/tech-stack.md#platform-apis) |
| Model-switch dispatch (Now branch) | `app.commands.executeCommandById("leo-reindex-vault")` so the command path is the single source of truth | [Code style — Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| Empty-state CTA card | React component rendered inside the F04 ChatView empty-thread region, reusing the F04 empty-state pattern (same region F04 reserves at `MessageList`); `<section role="region" aria-labelledby="leo-idx-cta-title">`; card button uses `class="mod-cta"` for Obsidian's primary-button styling | [UI Layer — Framework](../../../../standards/tech-stack.md#ui-layer); [Architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views); [F04 chat-sidebar-view](../chat-sidebar-view/feature.md) |
| CTA button dispatch | `app.commands.executeCommandById("leo-reindex-vault")` — shared command path with Flow B | [Code style — Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| CTA mount / unmount gating | `useEffect` subscribing to F03 first-run flag + F27 `IndexHeader` presence; auto-unmount on first `indexer.drain.complete` | [Code style — React 18](../../../../standards/code-style.md#react-18); [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) |
| Structured logging | [F01 Logger](../plugin-bootstrap-logging/feature.md) emits `indexer.ui.reindex-command` / `indexer.ui.model-switch-prompt` / `indexer.ui.empty-state-cta` / `indexer.ui.status-bar-throttled`; no file paths or plan content above `debug` per [NFR-LOG-04](../../context.md#nfr-log-04) | [Code style — Logging](../../../../standards/code-style.md#logging); [Architecture §5.1 Plugin Startup](../../../../architecture/architecture.md#51-plugin-startup) |
| Theming | Obsidian CSS variables only (`--text-muted` / `--background-modifier-border` / `--interactive-accent` / `--color-orange` / `--color-green`); zero colour literals asserted by unit test | [UI Layer — Styling](../../../../standards/tech-stack.md#ui-layer); [Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) |
| Reduced motion | `prefers-reduced-motion: reduce` suppresses status-bar node fade-in on mount and CTA card fade; final state applies instantly | [Code style — Styling](../../../../standards/code-style.md#styling-tailwind--obsidian) |
| Keyboard reachability | Palette entry (Cmd/Ctrl-P), CTA card button Tab-reachable inside MessageList, Modal buttons Tab/Shift-Tab cycle; no mouse-only path anywhere | [Architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) |
| Lifecycle registration | `Plugin.registerEvent` for F27 bus subscriptions; `useEffect` return cleanup for F03 settings subscription; `cancelAnimationFrame` on teardown | [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) |
| Unit tests | Vitest + jsdom + `vi.useFakeTimers`; in-memory `VaultAdapter` fake, stubbed F27 event bus; covers Status-bar mount/tick/unmount, `rAF` coalescing, command re-enqueue, modal branches, CTA mount/unmount, zero-colour-literal audit | [Code style — Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw); [Testing](../../../../standards/tech-stack.md#testing) |

Accessibility invariants applied across every surface this feature owns ([NFR-USE-07](../../context.md#nfr-use-07), [NFR-USE-10](../../context.md#nfr-use-10), [NFR-USE-11](../../context.md#nfr-use-11)):

- Status-bar label is a polite live-region; screen-reader announces files-left updates without interrupting.
- Modal is native, so it inherits Obsidian's WCAG-audited focus trap and announce contract; Esc / backdrop / `[x]` all resolve to `Later` (non-destructive default).
- CTA card is Tab-reachable along the natural MessageList flow; the button is a native `<button>` with `class="mod-cta"` so Obsidian's focus ring (`var(--interactive-accent)`) applies.
- No color-only signal — status-bar carries icon + text, CTA carries title + supporting copy + button, modal carries title + body + three distinct button labels.
- `prefers-reduced-motion: reduce` suppresses every opacity / width transition this feature owns; the final state still paints.

## Back-link

[<- feature.md](./feature.md)
