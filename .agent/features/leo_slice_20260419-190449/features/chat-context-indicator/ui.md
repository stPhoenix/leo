# F09 — Context indicator chip · UI

## Layout

The chip fills the `ContextIndicator` region reserved by [F04 chat-sidebar-view](../chat-sidebar-view/feature.md) — a single row between `HeaderBar` and `MessageList`. It is a horizontally laid-out inline chip (`document icon + basename · viewport · optional selection`) anchored flush-left with right-side padding for the shell's responsive edge. Icons come from [`setIcon`](../../../../standards/tech-stack.md#platform-apis) on Obsidian's bundled Lucide set ([UI Layer — Icons](../../../../standards/tech-stack.md#ui-layer)); colours, borders, and focus rings resolve through Obsidian CSS variables ([UI Layer — Styling](../../../../standards/tech-stack.md#ui-layer), [Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)). The chip re-renders in lockstep with the 300ms trailing-debounced `FocusedContext` stream emitted by [F08 editor-bridge-focused-context](../editor-bridge-focused-context/feature.md) ([Architecture §4 Key Contracts — FocusedContext](../../../../architecture/architecture.md#4-key-contracts)).

### Wireframe 1 — Full-width chip (≥ 280px), note + viewport + selection

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|
+-------------------------------------------------+
| HeaderBar  (F04)                                |
+-------------------------------------------------+
| ContextIndicator (this feature)                 |
|                                                 |
| +---------------------------------------------+ |
| | [D] Notes/Inbox.md · lines 42-78 · sel 54-60| |   <- [D] = setIcon("file-text")
| +---------------------------------------------+ |      role="button" tabindex=0
|                                                 |      bg: --background-secondary
+-------------------------------------------------+      fg: --text-muted
| MessageList (F05)                    ...        |      border: --background-modifier-border
```

- The chip is a single `<button type="button">` (or `<div role="button" tabindex="0">`) so it is keyboard-reachable with Enter / Space activation ([Code style — React 18](../../../../standards/code-style.md#react-18)).
- Basename is derived from `FocusedContext.file` with the `.md` extension stripped when present; path prefix (`Notes/`) is kept for disambiguation and truncated middle-out at widths < 280px (see Wireframe 2) ([Architecture §4 Key Contracts — FocusedContext](../../../../architecture/architecture.md#4-key-contracts)).
- Viewport and selection badges read `FocusedContext.viewport.{start,end}` and `FocusedContext.selection.{start,end}`; when the selection is empty the `· sel X-Y` suffix is omitted — never rendered as `sel 0-0` ([feature.md#acceptance-criteria](./feature.md#acceptance-criteria) item 3).

### Wireframe 2 — Collapsed single-line summary (width < 280px)

```
 0        10        20        30
 |---------|---------|---------|
+-------------------------------+
| HeaderBar  (F04, collapsed)   |
+-------------------------------+
| ContextIndicator (collapsed)  |
|                               |
| +---------------------------+ |
| | [D] Inbox · 42-78 · 54-60 | |   <- path prefix dropped (middle-out)
| +---------------------------+ |      "lines" / "sel" labels dropped
|                               |      native title= full "Notes/Inbox.md lines 42-78 sel 54-60"
+-------------------------------+
| MessageList          ...      |
```

- Collapse trigger is the shell's responsive contract: `ContextIndicator` reads its own `clientWidth` via a single `ResizeObserver` established by `ChatView` and flips a `data-collapsed="true"` attribute at the 280px breakpoint inherited from [F04](../chat-sidebar-view/feature.md) ([Platform APIs](../../../../standards/tech-stack.md#platform-apis)).
- The native `title` attribute carries the full uncollapsed string so hover / long-press on touch surfaces still reveals the full path — no custom tooltip layer required ([UI Layer — Styling](../../../../standards/tech-stack.md#ui-layer)).
- Labels `lines` and `sel` are shed before the basename is truncated, so the numeric ranges remain visible even at narrow widths; further shrinkage truncates the basename middle-out with a `…` replacement character ([Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)).

### Wireframe 3 — Hidden / empty state (null payload, no active markdown editor)

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|
+-------------------------------------------------+
| HeaderBar  (F04)                                |
+-------------------------------------------------+
| (ContextIndicator row collapsed to 0 height)    |   <- chip unmounted entirely
+-------------------------------------------------+      no placeholder text
| MessageList (F05)                    ...        |      no residual stale range
```

- When `FocusedContext` is `null` the chip returns `null` from its render body so React unmounts the DOM subtree — no skeleton, no "no note" stub — per AC 5 ([feature.md#acceptance-criteria](./feature.md#acceptance-criteria) item 5, [Code style — React 18](../../../../standards/code-style.md#react-18)).
- The `ContextIndicator` slot itself keeps its reserved row in the shell layout ([F04](../chat-sidebar-view/feature.md)) but collapses to zero intrinsic height because its sole child is unmounted; the `HeaderBar` / `MessageList` boundary stays visually clean ([Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views)).

### Wireframe 4 — Hover / focus state with click-to-reveal affordance

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|
+-------------------------------------------------+
| ContextIndicator (focused)                      |
|                                                 |
| +=============================================+ |   <- === = 2px focus ring
| | [D] Notes/Inbox.md · lines 42-78 · sel 54-60| |      --interactive-accent
| +=============================================+ |      cursor: pointer
|   "Open Notes/Inbox.md at line 54"              |      bg hover: --background-modifier-hover
+-------------------------------------------------+      aria-label interpolated
```

- Hover swaps the background to `var(--background-modifier-hover)` and exposes a `cursor: pointer`; focus adds a 2px ring via `box-shadow: 0 0 0 2px var(--interactive-accent)` ([UI Layer — Styling](../../../../standards/tech-stack.md#ui-layer), [Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)).
- The chip carries `aria-label="Open <path> at line <selection.start || viewport.start>"` so screen readers announce the click-to-reveal affordance directly ([Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views)).
- Background / ring transitions are a 120ms opacity fade gated by `@media (prefers-reduced-motion: no-preference)`; under `prefers-reduced-motion: reduce` the hover / focus state swap is instantaneous ([Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)).

## State machine

All states live inside a single `ContextIndicator` component owned by `ChatView` ([Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views)); its only external input is the `FocusedContext` stream from [F08](../editor-bridge-focused-context/feature.md) and its only external output is an Obsidian `workspace.openLinkText` call on click.

### `ContextIndicatorVisibilityMachine`

```
                 +----------+
                 |  hidden  |<---------------------+
                 +----+-----+                      |
                      | FocusedContext non-null     |
                      v                      null  |
              +-------+------------+          payload
              | visible            |----------+
              | (no-selection)     |<------+  |
              +---+------------+---+       |  |
                  ^            |           |  |
 selection empty  |            | selection |  |
                  |            | non-empty |  |
                  |            v           |  |
              +---+----+------------+      |  |
              | visible             |------+  |
              | (with-selection)    |---------+
              +---------------------+  null payload
```

- `hidden` is the only state that unmounts the chip DOM; both `visible(no-selection)` and `visible(with-selection)` share the same DOM tree and only differ by whether the `sel X-Y` badge renders ([feature.md#acceptance-criteria](./feature.md#acceptance-criteria) items 3 and 5).
- The transition between `visible(no-selection)` ↔ `visible(with-selection)` never unmounts the chip, preventing a flicker when the user simply clears or extends their selection ([Code style — React 18](../../../../standards/code-style.md#react-18)).

### `ContextIndicatorWidthMachine`

```
                +-------+    clientWidth >= 280    +-----------+
                | full  |<------------------------+| collapsed |
                +---+---+                          +-----+-----+
                    |         clientWidth < 280          ^
                    +------------------------------------+
```

- Width evaluation is driven by one `ResizeObserver` attached to the `ContextIndicator` element; the observer is created on mount and disconnected on unmount ([Platform APIs](../../../../standards/tech-stack.md#platform-apis), [Code style — Async & Concurrency](../../../../standards/code-style.md#async--concurrency)).
- The state swap flips a `data-collapsed="true|false"` attribute; both label-shedding and middle-out truncation are pure CSS so no extra render pass is required ([Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)).

### `ContextIndicatorFocusMachine`

```
                +-----------+   focus / Tab-in   +---------+
                | unfocused |-------------------->| focused |
                +-----------+                    +----+----+
                        ^                             |
                        |    blur / Tab-out / click   |
                        +-----------------------------+
```

- The chip is focusable via the global Tab order (no `tabindex="-1"`); Enter and Space on the focused chip dispatch the same `onClick` handler ([Code style — React 18](../../../../standards/code-style.md#react-18)).
- The visible focus ring satisfies keyboard reachability; under `prefers-reduced-motion: reduce` the ring appears without opacity transition ([Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)).

## Event flow

All flows are registered in a single `useEffect` owned by `ContextIndicator` and torn down on unmount together with the subscription and the `ResizeObserver` ([Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules), [Code style — Async & Concurrency](../../../../standards/code-style.md#async--concurrency)).

### 1. Focused Context payload arrives → chip re-renders (debounced) → truncates long paths

```
[F08 EditorBridge]                       [ContextIndicator]
FocusedContext { file, cursor,    ----> onFocusedContext(payload)
                 selection, viewport }          |
(300ms trailing debounce owned by F08)          v
                                         reducer: pick next state
                                           payload.selection empty?
                                             yes -> visible(no-selection)
                                             no  -> visible(with-selection)
                                                |
                                                v
                                         React render:
                                           strip ".md" from file basename
                                           interpolate "lines X-Y"
                                           interpolate "sel X-Y" if non-empty
                                                |
                                                v
                                         CSS truncation (data-collapsed)
                                         kicks in at <280px; title=
                                         attribute carries the full path
```

- The debounce is inherited wholly from [F08](../editor-bridge-focused-context/feature.md) — no additional debounce is layered here, so the chip updates within one trailing 300ms tick of any cursor / selection / viewport / active-leaf change per AC 4 ([feature.md#acceptance-criteria](./feature.md#acceptance-criteria) item 4).
- Re-render is skipped when the incoming payload is referentially equal to the previous one (shallow compare of `file.path`, `cursor`, `selection`, `viewport`) — prevents a double-fire against the same payload ([Code style — React 18](../../../../standards/code-style.md#react-18)).

### 2. Null payload → chip hides

```
[F08 EditorBridge]
FocusedContext = null   ----> onFocusedContext(null)
(no active markdown editor)          |
                                     v
                               reducer: visibility = hidden
                                     |
                                     v
                               React render returns null
                                     |
                                     v
                               DOM subtree unmounts; the
                               ContextIndicator row collapses
                               to zero height (no placeholder)
```

- Matches AC 5: no placeholder text, no residual stale range; the chip reappears automatically on the next non-null payload ([feature.md#acceptance-criteria](./feature.md#acceptance-criteria) item 5).

### 3. Click on chip → `workspace.openLinkText` reveals note + moves cursor

```
[User click / Enter / Space on chip]
         |
         v
   onClick(event)
         |
         v
   read last FocusedContext from ref
   (guard: ignore if payload = null)
         |
         v
   const line = selection?.start ?? viewport.start
   app.workspace.openLinkText(
     file.path, "", /*newLeaf=*/ false
   )
         |
         v
   leaf.view.editor.setCursor({ line, ch: 0 })
   leaf.view.editor.scrollIntoView(...)
         |
         v
   [F08] emits next FocusedContext
   (300ms later) -> chip re-renders with
   new viewport centred on the revealed line
```

- Uses Obsidian's native `workspace.openLinkText` (no new leaf when the note is already open) satisfying AC 6's "no-op focus" clause ([Platform APIs](../../../../standards/tech-stack.md#platform-apis), [feature.md#acceptance-criteria](./feature.md#acceptance-criteria) item 6).
- Cursor move and scrollIntoView are best-effort; if the opened leaf is not a `MarkdownView` (e.g. a canvas) the cursor call is skipped — click still focuses the leaf per [Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views).

### 4. Teardown (unmount, thread switch, plugin unload)

```
onClose / thread switch / onunload
         |
         v
   unsubscribe from EditorBridge FocusedContext stream
   disconnect ResizeObserver
   null out the "last payload" ref
```

- All effects register their unregister fn in the `useEffect` cleanup, so React guarantees symmetric subscribe / unsubscribe at mount / unmount ([Code style — React 18](../../../../standards/code-style.md#react-18), [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules)).

## Component mapping

| UI block | Platform / lib | Notes |
|---|---|---|
| Document icon | [`setIcon(iconEl, "file-text")`](../../../../standards/tech-stack.md#platform-apis) from Obsidian's bundled Lucide set ([UI Layer — Icons](../../../../standards/tech-stack.md#ui-layer)) | Painted once on mount into a dedicated `<span>` before the basename; re-paint only runs if the ref swaps. Backing contract: [Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views). |
| FocusedContext subscription | EditorBridge push channel from [F08 editor-bridge-focused-context](../editor-bridge-focused-context/feature.md); consumed via a single `useEffect` in `ContextIndicator` ([Code style — React 18](../../../../standards/code-style.md#react-18)) | Symmetric subscribe on mount / unsubscribe on unmount (AC via the feature's unit tests). Payload shape `{file, cursor, selection, viewport}` pinned by [Architecture §4 Key Contracts](../../../../architecture/architecture.md#4-key-contracts). |
| Basename + badge labels (`lines X-Y`, `sel X-Y`) | React render over the latest `FocusedContext` ([UI Layer](../../../../standards/tech-stack.md#ui-layer)) | `.md` extension stripped; `sel` badge omitted when selection is empty. Mapping traced to FR-CHAT-09 by [Architecture §11 SRS FR → Modules](../../../../architecture/architecture.md#11-mapping-srs-fr--modules). |
| Responsive collapse (`data-collapsed`) | [`ResizeObserver`](../../../../standards/tech-stack.md#platform-apis) observing the chip element | Created on mount, `disconnect()` on unmount; flips `data-collapsed` at the 280px breakpoint inherited from [F04 chat-sidebar-view](../chat-sidebar-view/feature.md) ([Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules)). |
| Middle-out truncation + native `title` tooltip | Pure CSS (`max-width`, `text-overflow: ellipsis`) + DOM `title` attribute ([UI Layer — Styling](../../../../standards/tech-stack.md#ui-layer), [Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)) | Keeps the single-line footprint at ≥ 280px and reveals the full path on hover / long-press at < 280px — no custom tooltip layer. |
| CSS variables for chip colours | Obsidian CSS variables only ([UI Layer — Styling](../../../../standards/tech-stack.md#ui-layer), [Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)) | `background: var(--background-secondary)`; `color: var(--text-muted)`; `border: 1px solid var(--background-modifier-border)`; hover `var(--background-modifier-hover)`; focus ring `var(--interactive-accent)`. No hardcoded colours. Theme-aware by [Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views). |
| Keyboard reachability (`<button>` + Enter/Space) | Native HTML button semantics (default Tab order, no `tabindex="-1"`) ([Code style — React 18](../../../../standards/code-style.md#react-18)) | Visible focus ring is the reduced-motion-safe indicator; `aria-label="Open <path> at line <N>"` narrates the click-to-reveal affordance ([Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views)). |
| Click-to-reveal | [`app.workspace.openLinkText(path, "", false)`](../../../../standards/tech-stack.md#platform-apis) + optional `editor.setCursor` | No-op focus when the note is already the active leaf (AC 6). Traced to FR-CHAT-09 via [Architecture §11 SRS FR → Modules](../../../../architecture/architecture.md#11-mapping-srs-fr--modules). |
| Reduced-motion gate | `@media (prefers-reduced-motion: reduce)` around the 120ms hover / focus-ring transition ([Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)) | Under `reduce`, hover / focus state swaps are instantaneous; visual affordance survives unchanged. Aligned with [Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views). |
| Teardown (unmount, thread switch, plugin unload) | React `useEffect` cleanup + `ItemView.onClose` ([Platform APIs](../../../../standards/tech-stack.md#platform-apis), [Code style — Async & Concurrency](../../../../standards/code-style.md#async--concurrency)) | Unsubscribes from the F08 stream, disconnects the `ResizeObserver`, and clears the last-payload ref — enforcing the "no dangling listeners or timers" rule of [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules). |

## Back-link

- [feature.md](./feature.md)
