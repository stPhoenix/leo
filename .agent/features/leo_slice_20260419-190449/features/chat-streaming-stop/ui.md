# F07 — Streaming render & stop control · UI

## Layout

All wireframes render inside the `MessageList` tail plus the `ComposerInput` footer regions reserved by [F04](../chat-sidebar-view/feature.md); only the streaming-relevant slice is drawn here. The animated cursor `▋` paints at the tail of the in-flight assistant bubble; the composer send glyph swaps to a stop glyph while a turn is live. Icons are painted by [`setIcon`](../../../../standards/tech-stack.md#platform-apis) from Obsidian's bundled Lucide set ([UI Layer — Icons](../../../../standards/tech-stack.md#ui-layer)); colours, borders, and focus rings resolve through Obsidian CSS variables ([UI Layer — Styling](../../../../standards/tech-stack.md#ui-layer), [Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)). Banner colours map to Obsidian semantic tokens (`--color-orange` / `--text-error`) to stay theme-aware.

### Wireframe 1 — Streaming assistant message with animated cursor and stop button (amber)

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|
+-------------------------------------------------+
| MessageList (tail only; earlier bubbles stable) |
+-------------------------------------------------+
| +---------------------------------------------+ |
| | user                                   09:41| |
| | Summarise the highlighted section.          | |
| +---------------------------------------------+ |
|                                                 |
| +---------------------------------------------+ |
| | assistant                              09:41| |
| | Here is a compact summary of the section:   | |
| |                                             | |
| | - Introduces the streaming contract and the | |
| |   token append order required by FR-CHAT-04 | |
| | - Notes that the stop control must abort    | |
| |   atomically per FR-CHAT-05▋                | |   <- ▋ = animated cursor
| +---------------------------------------------+ |
+-------------------------------------------------+
| ComposerInput (send slot swapped to stop glyph) |
+-------------------------------------------------+
| +-----------------------------------------+ +--+|
| | (draft locked while streaming, muted)   | |[]||   <- [] = square / stop glyph
| |                                         | |  ||      button tinted amber
| +-----------------------------------------+ +--+|
|  "Streaming... press Esc or Stop to cancel"      |
+-------------------------------------------------+
[ SR-only <div aria-live="assertive"> : "streaming started" ]
```

- The tail assistant bubble is the only React node re-rendered per token; earlier turns keep stable keys from [F05](../chat-message-list-markdown/feature.md) so React reconciliation touches only the tail bubble ([Code style — React 18](../../../../standards/code-style.md#react-18), [Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views)).
- The cursor `▋` is a CSS `::after` pseudo-element with a 1s blink keyframe; stop button is painted by [`setIcon("square")`](../../../../standards/tech-stack.md#platform-apis) and coloured with `background: var(--color-orange)` / `color: var(--text-on-accent)` ([UI Layer — Styling](../../../../standards/tech-stack.md#ui-layer)).
- The assertive SR region is a sibling `<div role="status" aria-live="assertive" aria-atomic="true">` rendered by `ChatView`, distinct from the polite `role="log"` announcer in [F05](../chat-message-list-markdown/feature.md) ([Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views)).

### Wireframe 2 — Cancelled banner after Stop ("cancelled after N tools")

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|
+-------------------------------------------------+
| MessageList (tail after cancel)                 |
+-------------------------------------------------+
| +---------------------------------------------+ |
| | assistant                              09:41| |
| | Here is a compact summary of the section:   | |
| |                                             | |
| | - Introduces the streaming contract and the | |
| |   token append order required by FR-CHAT-04 | |
| | - Notes that the stop control must abort    | |   <- cursor removed
| +---------------------------------------------+ |
|                                                 |
| +---------------------------------------------+ |
| | [!] cancelled after 2 tools                 | |   <- banner, amber border
| |     (Stop at 09:41:17)                      | |      bg: --background-modifier-border
| +---------------------------------------------+ |      fg: --color-orange
+-------------------------------------------------+
| ComposerInput (unlocked, send glyph restored)   |
+-------------------------------------------------+
| +-----------------------------------------+ +--+|
| | |                                       | |> ||   <- | = caret, send enabled
| +-----------------------------------------+ +--+|
+-------------------------------------------------+
[ SR-only <div aria-live="assertive"> : "cancelled after 2 tools" ]
```

- The banner is a non-bubble row rendered by `MessageList` below the partial assistant bubble, with `role="status"` and the token counter `N` interpolated from the turn's tool-run counter ([Architecture §5.6 Cancellation](../../../../architecture/architecture.md#56-cancellation)).
- `N` is sourced from the per-turn counter owned by `AgentRunner` ([Architecture §6 State Ownership](../../../../architecture/architecture.md#6-state-ownership)); for a pre-tool stop the banner reads "cancelled after 0 tools".

### Wireframe 3 — Streaming error banner (red)

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|
+-------------------------------------------------+
| MessageList (tail after stream error)           |
+-------------------------------------------------+
| +---------------------------------------------+ |
| | assistant                              09:41| |
| | Here is a compact summary of the section:   | |
| |                                             | |
| | - Introduces the streaming contract and     | |   <- cursor removed, bubble frozen
| +---------------------------------------------+ |
|                                                 |
| +---------------------------------------------+ |
| | (X) stream error: connection reset          | |   <- banner, red border
| |     Retry  |  Dismiss                       | |      bg: --background-modifier-error
| +---------------------------------------------+ |      fg: --text-error
+-------------------------------------------------+
| ComposerInput (unlocked, send glyph restored)   |
+-------------------------------------------------+
[ SR-only <div aria-live="assertive"> : "stream error: connection reset" ]
```

- Banner colour tokens are Obsidian's semantic error tokens (`--background-modifier-error`, `--text-error`) so themes pick them up automatically ([UI Layer — Styling](../../../../standards/tech-stack.md#ui-layer), [Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)).
- Retry reopens the stream via the same `AgentRunner.cancel`-aware path ([Architecture §5.6 Cancellation](../../../../architecture/architecture.md#56-cancellation), [Agent Layer — Cancel](../../../../standards/tech-stack.md#agent-layer)); Dismiss only clears the banner.

## State machine

All states live in the streaming reducer owned by `ChatView` ([Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views)); the single source of abort authority is one `AbortController` per turn ([Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules), [Agent Layer — Cancel](../../../../standards/tech-stack.md#agent-layer)).

### `StreamingTurnMachine`

```
                          +---------+
                          |  idle   |
                          +----+----+
                               | send (user submit from F06)
                               v
                          +----+-----+
            +-------------> streaming|<------------+
            |             +----+-----+             |
            |  tool.done       | tool_call         | token
            |             +----+-----+             |
            +-------------+ tool-    +-------------+
                          | running  |
                          +----+-----+
                               | done (terminal SSE)
                               v
                          +----+----+
                          |  done   |---> back to idle (composer unlocked)
                          +---------+

 Cancel path:
 streaming  --stop (button / Esc)-->  cancelling
 cancelling --in-flight tool resolves (if any)-->  cancelled(N tools)
 cancelled(N tools) ---> back to idle (banner persists in transcript)

 Error path:
 streaming  --SSE error-->  error ---> back to idle (error banner persists)
```

- `[tool-running]*` means zero-or-more tool-running interludes may occur between token bursts; each resolves back to `streaming` atomically ([Architecture §5.6 Cancellation](../../../../architecture/architecture.md#56-cancellation)).
- `cancelling` is the window where the current tool call is allowed to finish atomically and remaining queued tool calls are skipped; no further tokens are appended ([feature.md#acceptance-criteria](./feature.md#acceptance-criteria) item 4, [Architecture §5.6 Cancellation](../../../../architecture/architecture.md#56-cancellation)).
- `N` is the turn's tool-run counter at the moment the terminal transition fires ([Architecture §6 State Ownership](../../../../architecture/architecture.md#6-state-ownership)).

### `CursorAnimationMachine` (reduced-motion variant)

```
+-----------+     mount tail bubble      +-----------+
| hidden    +--------------------------->+ blinking  |
+-----------+                            +-----+-----+
      ^                                        |
      |                                        | done | error | cancel
      +----------------------------------------+

Branch gate (evaluated at mount):
  matchMedia("(prefers-reduced-motion: reduce)").matches === true
      --> cursor enters `static-visible` (no keyframe animation)
      --> same exit transitions as `blinking`
```

- The CSS blink keyframe is gated by `@media (prefers-reduced-motion: no-preference)`; the React effect also reads `window.matchMedia("(prefers-reduced-motion: reduce)")` and adds a `data-reduced-motion="true"` attribute so the cursor renders as a static glyph ([Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian), [Code style — React 18](../../../../standards/code-style.md#react-18)).

## Event flow

All flows are mounted once per `ChatView` instance and torn down in `onClose` together with the `AbortController` and the rAF loop ([Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules), [Code style — Async & Concurrency](../../../../standards/code-style.md#async--concurrency)).

### 1. Token arrival (provider SSE → rAF render batch at 60fps)

```
[F02 provider SSE]                       [ChatView streaming reducer]
StreamEvent.token ---------------------> push into pendingTokens ring
                                         schedule rAF flush (if not pending)
                                                |
                                                v
                                         requestAnimationFrame(tick):
                                           drain pendingTokens
                                           append to tail bubble text
                                           mark frame budget consumed
                                                |
                                                v
                                         [F05 MessageList tail bubble
                                          re-renders, earlier bubbles
                                          untouched]
```

- Tokens are appended in arrival order; the tail bubble re-renders via React once per animation frame rather than once per token, keeping frame budget within the 60fps ceiling demanded by [NFR-PERF-05](../../context.md#nfr-perf-05) ([Code style — React 18](../../../../standards/code-style.md#react-18), [Architecture §5.2 Chat Turn (no tools)](../../../../architecture/architecture.md#52-chat-turn-no-tools)).

### 2. User presses Stop (button or Esc)

```
[User click stop button]          [User press Esc in composer (F06)]
         |                                       |
         +-------+             +-----------------+
                 v             v
            onStopIntent() (single handler)
                 |
                 v
         AbortController.abort()
                 |
         +-------+------------------------+
         v                                v
 [F02 provider SSE reader]         [Agent tool slot]
  cancel fetch, no more tokens     if in-flight: allow atomic finish
                                   queued tools: skipped
                 |
                 v
         streaming reducer: enter `cancelling`
                 |
                 v
         on tool atomic-finish (or immediately if no tool ran):
         enter `cancelled(N tools)`
                 |
                 v
         MessageList appends "cancelled after N tools" banner
         aria-live="assertive" announces "cancelled after N tools"
         Composer: restore send glyph, unlock draft
```

- Esc precedence is owned by [F06](../chat-composer-input/feature.md): when a stream is active Esc routes to `onStopIntent` first; only if no stream is running does Esc close the inline confirmation owned by [F04](../chat-sidebar-view/feature.md).
- A single shared `AbortController` per turn is the one abort authority, matching [Agent Layer — Cancel](../../../../standards/tech-stack.md#agent-layer) and [Architecture §5.6 Cancellation](../../../../architecture/architecture.md#56-cancellation).

### 3. Stream error path

```
[F02 provider SSE] error --> streaming reducer: enter `error`
                              |
                              v
                        freeze tail bubble (cursor removed)
                        append error banner (red) to transcript
                        aria-live="assertive" announces
                          "stream error: <message>"
                        Composer: restore send glyph, unlock draft
```

- Mirrors the error entries in [Architecture §7 Error Handling Strategy](../../../../architecture/architecture.md#7-error-handling-strategy); the assertive region carries the announcement required by [NFR-USE-08](../../context.md#nfr-use-08).

### 4. Teardown (unmount, thread switch, plugin unload)

```
onClose / thread switch / onunload
         |
         v
  AbortController.abort()   (same controller as Stop)
  cancel pending rAF handle
  detach SSE reader
  remove keydown listener (Esc)
  unmount aria-live region
```

- All effects are registered via React `useEffect` cleanups and the controller is tied to `ChatView`'s lifecycle per [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) and [Code style — Async & Concurrency](../../../../standards/code-style.md#async--concurrency).

## Component mapping

| UI block | Platform / lib | Notes |
|---|---|---|
| SSE stream reader | [`fetch` + `ReadableStream` in the F02 LM Studio adapter](../../../../standards/tech-stack.md#agent-layer); consumed via React effect in `ChatView` | Each `StreamEvent.token` pushes into the rAF-batched pending ring. Backing contract: [Architecture §4 Key Contracts](../../../../architecture/architecture.md#4-key-contracts), [Architecture §5.2 Chat Turn (no tools)](../../../../architecture/architecture.md#52-chat-turn-no-tools). |
| Single `AbortController` per turn | [Agent Layer — Cancel (`AbortController` → `.stream({ signal })`)](../../../../standards/tech-stack.md#agent-layer) | One controller per turn, shared by stop-button, Esc route from [F06](../chat-composer-input/feature.md), unmount cleanup, and the F02 provider. Lifecycle matches [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) and [Architecture §5.6 Cancellation](../../../../architecture/architecture.md#56-cancellation). |
| `requestAnimationFrame` token batching | Browser rAF API used from React ([Code style — React 18](../../../../standards/code-style.md#react-18), [Code style — Async & Concurrency](../../../../standards/code-style.md#async--concurrency)) | Drains `pendingTokens` once per frame; cancels outstanding handle on teardown. Targets the 60fps budget of [NFR-PERF-05](../../context.md#nfr-perf-05); see also [Architecture §5.2 Chat Turn (no tools)](../../../../architecture/architecture.md#52-chat-turn-no-tools). |
| Animated cursor `▋` | CSS keyframe + `data-reduced-motion` attribute gate ([UI Layer — Styling](../../../../standards/tech-stack.md#ui-layer), [Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)) | `@media (prefers-reduced-motion: reduce)` plus `window.matchMedia` gate disables the blink keyframe; rendered as `::after` on the tail bubble so no extra DOM node ([Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views)). |
| Assertive live region `<div aria-live="assertive" aria-atomic="true">` | DOM primitive rendered by `ChatView` ([UI Layer](../../../../standards/tech-stack.md#ui-layer)) | Owns announcements for "streaming started", "streaming stopped" / "cancelled after N tools", and stream errors — distinct from the polite `role="log"` announcer in [F05](../chat-message-list-markdown/feature.md). Realises [NFR-USE-08](../../context.md#nfr-use-08). |
| Stop button glyph | [`setIcon(buttonEl, "square")`](../../../../standards/tech-stack.md#platform-apis) | Reuses the composer send-button slot owned by [F06](../chat-composer-input/feature.md); tinted via Obsidian CSS variables (`--color-orange` / `--text-on-accent`) ([UI Layer — Styling](../../../../standards/tech-stack.md#ui-layer)). Restores to `setIcon("send")` on terminal transition. |
| Cancelled / error banners | Obsidian semantic tokens (`--color-orange`, `--background-modifier-border`, `--background-modifier-error`, `--text-error`) ([UI Layer — Styling](../../../../standards/tech-stack.md#ui-layer), [Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)) | Rendered inside `MessageList` as non-bubble rows so they stay pinned to the transcript tail and respect the scroll anchor from [F05](../chat-message-list-markdown/feature.md); anchored by [Architecture §5.6 Cancellation](../../../../architecture/architecture.md#56-cancellation). |
| Keyboard Esc route | Composer `keydown` handler from [F06](../chat-composer-input/feature.md) | Esc precedence: (1) stop active stream, (2) close inline confirmation owned by [F04](../chat-sidebar-view/feature.md), (3) blur composer. Aligned with [Code style — React 18](../../../../standards/code-style.md#react-18) and [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules). |
| Teardown (unmount, thread switch, plugin unload) | React `useEffect` cleanup + `ItemView.onClose` ([Platform APIs](../../../../standards/tech-stack.md#platform-apis), [Code style — Async & Concurrency](../../../../standards/code-style.md#async--concurrency)) | Aborts the controller, cancels the rAF handle, detaches the SSE reader, removes the Esc listener, and unmounts the live region — enforcing the "no dangling listeners or timers" rule of [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules). |

## Back-link

- [feature.md](./feature.md)
