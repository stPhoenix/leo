# F12 — Token usage indicator · UI

## Layout

The footer is a single-line slot painted at the bottom of every assistant bubble rendered by [F05 chat-message-list-markdown](../chat-message-list-markdown/feature.md); a sibling aggregate badge lives in the `HeaderBar` region reserved by [F04 chat-sidebar-view](../chat-sidebar-view/feature.md). All colours, borders, and focus rings resolve through Obsidian CSS variables ([UI Layer — Styling](../../../../standards/tech-stack.md#ui-layer), [Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)); no hardcoded palette. Token counts render verbatim from the provider `usage` payload terminal event emitted by [F02 provider-lmstudio-core](../provider-lmstudio-core/feature.md) (see [Architecture §4 Key Contracts — StreamEvent](../../../../architecture/architecture.md#4-key-contracts)), or, when absent, from the `Math.ceil(len / 4)` fallback estimator defined in [feature.md](./feature.md).

### Wireframe 1 — Assistant bubble footer, API-sourced counts (provider `usage` present)

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|
+-------------------------------------------------+
| MessageList (F05)                               |
+-------------------------------------------------+
| +---------------------------------------------+ |
| | assistant                              09:41| |
| | Here is a compact summary of the section.   | |
| |                                             | |
| | - token counts land on `done`               | |
| +---------------------------------------------+ |
| | in 142 · out 387 · total 529 tok            | |   <- footer span
| +---------------------------------------------+ |      role="status" (non-live)
+-------------------------------------------------+      aria-label="Token usage"
                                                         fg: --text-muted
                                                         font-size: var(--font-ui-smaller)
```

- The footer is a `<span role="status" aria-label="Token usage">` rendered as the last child of the assistant bubble from [F05](../chat-message-list-markdown/feature.md); it participates in the bubble's natural Tab order (no `tabindex="-1"`, no focus trap) ([Code style — React 18](../../../../standards/code-style.md#react-18)).
- Values are read verbatim from `usage.prompt_tokens` / `usage.completion_tokens` / `usage.total_tokens` on the terminal `done` `StreamEvent` ([Architecture §4 Key Contracts — StreamEvent](../../../../architecture/architecture.md#4-key-contracts), [Architecture §5.2 Chat Turn (no tools)](../../../../architecture/architecture.md#52-chat-turn-no-tools)); the `tok` unit label is static, dots are U+00B7 middle-dot for legibility under `var(--text-muted)` ([UI Layer — Styling](../../../../standards/tech-stack.md#ui-layer)).
- No cost slot is rendered in Phase 1 per [feature.md](./feature.md) AC 6; the DOM leaves no placeholder for `$` so F38 can append without a layout reflow.

### Wireframe 2 — Estimated-fallback footer (`usage` absent, `len/4` estimator)

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|
+-------------------------------------------------+
| +---------------------------------------------+ |
| | assistant                              09:42| |
| | Cached response from a minimal provider.    | |
| +---------------------------------------------+ |
| | ~529 tok (est.)                             | |   <- single-line estimate
| +---------------------------------------------+ |      `~` prefix flags fallback
                                                         aria-label="Token usage
                                                                     (estimated)"
                                                         title="input ~142 ·
                                                                output ~387
                                                                (len/4 estimate)"
+-------------------------------------------------+
```

- When `usage` is entirely absent the footer collapses to the total only, prefixed with `~` and suffixed with `(est.)`; the native `title` attribute carries the per-slot breakdown so hover / long-press reveals the full triple without a custom tooltip ([UI Layer — Styling](../../../../standards/tech-stack.md#ui-layer)).
- When `usage` is partial the footer uses the full three-slot layout from Wireframe 1 and prefixes only the estimated slots with `~`, e.g. `in 142 · out 387 · ~total 529 tok`, per [feature.md](./feature.md) AC 3.
- The `aria-label` interpolates `(estimated)` so screen readers distinguish API-sourced from estimated values without relying on the visual `~` marker ([Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views)).

### Wireframe 3 — HeaderBar aggregate thread total badge

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|
+-------------------------------------------------+
| [leo] Leo  [1,248 tok]              [-] [o] [x] |   <- HeaderBar total badge
+-------------------------------------------------+      role="status"
| ContextIndicator (F09)                          |      aria-live="off"
+-------------------------------------------------+      aria-label="Thread total:
| MessageList (F05)                               |                  1,248 tokens"
| +---------------------------------------------+ |      bg: --background-secondary
| | ... earlier bubbles, each with own footer   | |      fg: --text-muted
| +---------------------------------------------+ |      border:
| | in 142 · out 387 · total 529 tok            | |        --background-modifier-border
| +---------------------------------------------+ |
| +---------------------------------------------+ |
| | ... another assistant turn ...              | |
| +---------------------------------------------+ |
| | in 210 · out 509 · total 719 tok            | |
| +---------------------------------------------+ |
+-------------------------------------------------+
```

- The `[1,248 tok]` pill slots into the `HeaderBar` region reserved by [F04](../chat-sidebar-view/feature.md) between the title and the overflow actions; thousands separator uses `toLocaleString()` for locale-aware rendering ([Platform APIs](../../../../standards/tech-stack.md#platform-apis)).
- The badge sums every assistant message's `total` (API-sourced or estimated, mixed is allowed) so a single running counter reflects the same values the bubble footers render; re-sum runs only on footer commit to avoid per-token recompute ([Architecture §6 State Ownership](../../../../architecture/architecture.md#6-state-ownership)).
- At width < 280px (collapsed `HeaderBar` from [F04](../chat-sidebar-view/feature.md)) the badge label sheds the `tok` suffix, becoming `[1,248]`; the native `title` attribute keeps the full "1,248 tok (thread total)" string so information is never lost ([UI Layer — Styling](../../../../standards/tech-stack.md#ui-layer), [Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)).

### Wireframe 4 — Loading state during streaming (footer deferred, no count)

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|
+-------------------------------------------------+
| +---------------------------------------------+ |
| | assistant                              09:43| |
| | Partial token stream is still arriving...▋  | |   <- ▋ cursor from F07
| +---------------------------------------------+ |
| |                                             | |   <- footer slot reserved but
| +---------------------------------------------+ |      empty during streaming
+-------------------------------------------------+      aria-hidden="true"
| [leo] Leo  [1,248 tok]              [-] [o] [x] |      HeaderBar total unchanged
+-------------------------------------------------+      (last-committed value)
```

- While the tail bubble is streaming ([F07 chat-streaming-stop](../chat-streaming-stop/feature.md)) the footer slot mounts but renders no text; it reserves its own row height from empty so the bubble does not visibly re-layout when the `done` event lands ([Code style — React 18](../../../../standards/code-style.md#react-18), [Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)).
- The `HeaderBar` total badge stays pinned to its last committed value during streaming; it does not tick token-by-token (unit tests cover the "no per-token recompute" invariant from AC 4 of [feature.md](./feature.md)).
- On `prefers-reduced-motion: reduce` the streaming-to-final footer swap is instantaneous (no fade); otherwise a 120ms opacity fade-in is applied to the committed text only ([Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)).

## State machine

Two cooperating machines own the token state: `PerMessageTokenStateMachine` drives each assistant-message footer, and `HeaderBarTotalMachine` tracks the running aggregate. Both live inside `ChatView`'s React tree ([Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views)); the aggregate is derived state, never a separate source of truth ([Architecture §6 State Ownership](../../../../architecture/architecture.md#6-state-ownership)).

### `PerMessageTokenStateMachine`

```
                        +-----------+
                        |  unknown  |         <- bubble mounted, no usage yet
                        +-----+-----+
                              | terminal StreamEvent (done / error / cancel)
                              | received
                              v
              +-------------------------------+
              |   usage payload present?      |
              +-----+------------------+------+
                    | yes              | no / partial
                    v                  v
        +--------------------+   +--------------------------+
        | counted(api)       |   | counted(estimate)        |
        | in/out/total from  |   | missing fields via       |
        | usage.*            |   | Math.ceil(len/4)         |
        +---------+----------+   +------------+-------------+
                  |                           |
                  +---------+-----------------+
                            | footer commit
                            v
                        +---------+
                        |  final  |   <- read-only; no further token ticks
                        +---------+       no re-entry from streaming
```

- `unknown` is the entry state; the footer slot is mounted but empty (Wireframe 4) — keeps the bubble row height stable so `final` lands without layout reflow ([Code style — React 18](../../../../standards/code-style.md#react-18)).
- The `counted(api)` vs `counted(estimate)` branch is decided once on the terminal event; `counted(estimate)` applies when `usage` is absent *or* any of its three fields is missing (partial-usage case), in which case missing fields only are estimated per AC 3 of [feature.md](./feature.md).
- `final` is terminal: it renders the footer verbatim and never re-enters. Subsequent terminal events for the same bubble are dropped (unit test covers double-`done` idempotence from AC 4 of [feature.md](./feature.md)).
- No cost rendering is emitted in any state; the `$` slot is reserved for F38 and stays unrendered in Phase 1 per [feature.md](./feature.md) AC 6.

### Streaming-to-final render transition

```
            +----------+    tokens flow (F07 rAF batches)    +----------+
            | partial  |------------------------------------>| partial  |
            +----+-----+                                     +----+-----+
                 |                                                |
                 |             done / error / cancel              |
                 +------------------------------------------------+
                                        |
                                        v
                                   +---------+
                                   |  final  |
                                   +---------+
```

- `partial` mirrors F07's streaming state ([F07 chat-streaming-stop](../chat-streaming-stop/feature.md)); the footer stays in the `unknown` token state throughout (Wireframe 4).
- `final` flips both machines atomically: the assistant bubble text freezes and the footer commits its triple in the same React render so the user never sees a footer that disagrees with its bubble ([Architecture §5.2 Chat Turn (no tools)](../../../../architecture/architecture.md#52-chat-turn-no-tools)).

### `HeaderBarTotalMachine`

```
           +-------+   footer commit   +----------+
           | zero  |------------------>| counting |<-+
           +-------+                   +-----+----+  |
                                             |      | next footer commit
                                             +------+
```

- The total is `sum(messages[*].total)` recomputed only on footer commit events — one recompute per terminated assistant turn, never per streamed token ([Code style — React 18](../../../../standards/code-style.md#react-18)).
- The machine resets to `zero` on thread switch or `ChatView.onClose`; the reset is triggered by the same thread-lifecycle event [F04](../chat-sidebar-view/feature.md) uses for `MessageList` remount ([Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules)).

## Event flow

All flows are wired in a single `useEffect` on the `AssistantBubbleFooter` component plus a derived `useMemo` on the `HeaderBar` aggregate span; both are torn down on unmount with the owning bubble / view ([Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules), [Code style — Async & Concurrency](../../../../standards/code-style.md#async--concurrency)).

### 1. `done` event → read `usage` → render footer (API path)

```
[F02 provider-lmstudio-core]                 [AssistantBubbleFooter]
StreamEvent { type: "done",                  onTerminalEvent(event)
              usage: {                             |
                prompt_tokens: 142,                v
                completion_tokens: 387,      branch: event.usage present?
                total_tokens: 529 } }              |
         |                                         | yes -> counted(api)
         v                                         v
[F07 chat-streaming-stop]                    reducer: {
terminal hook fires                            in: usage.prompt_tokens,
         |                                     out: usage.completion_tokens,
         v                                     total: usage.total_tokens,
[AgentRunner]                                  source: "api"
commits final bubble snapshot               }
         |                                         |
         v                                         v
[ChatView] renders bubble in `final`          React render:
         |                                   <span role="status"
         |                                         aria-label="Token usage">
         +---------------------------------->     in 142 · out 387 · total 529 tok
                                                 </span>
```

- The `usage` shape is pinned by [Architecture §4 Key Contracts — StreamEvent](../../../../architecture/architecture.md#4-key-contracts); the OpenAI-compatible triple is read verbatim with no rescaling ([Agent Layer](../../../../standards/tech-stack.md#agent-layer)).
- The footer is committed in the same React render as the bubble's final text so the user never sees a footer that disagrees with its bubble ([Code style — React 18](../../../../standards/code-style.md#react-18)).

### 2. `done` event without `usage` → estimate fallback

```
[F02] StreamEvent { type: "done", usage: undefined }
         |
         v
[AssistantBubbleFooter] onTerminalEvent(event)
         |
         v
branch: event.usage absent -> counted(estimate)
         |
         v
reducer: read promptChars = lastUserMessage.text.length
         read outputChars = bubble.renderedMarkdown.text.length
         in  = Math.ceil(promptChars / 4)
         out = Math.ceil(outputChars / 4)
         total = in + out
         source = "estimate"
         |
         v
React render:
  <span role="status" aria-label="Token usage (estimated)"
        title="input ~142 · output ~387 (len/4 estimate)">
    ~529 tok (est.)
  </span>
```

- The `len/4` multiplier matches the boundary matrix in [feature.md](./feature.md) AC 7 (empty / 1-char / 4-char / 5-char); unit tests enforce those boundaries ([Code style — Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw)).
- Partial `usage` follows the same branch but only estimates the missing slots; present slots use `usage.*` verbatim and only missing slots carry the `~` visual marker per AC 3 of [feature.md](./feature.md).

### 3. Terminal event fan-out → HeaderBar total incremented

```
[AssistantBubbleFooter] emits onCommit({ total: 529 })
         |
         v
[ChatView] derives messages[*].total via useMemo
         |
         v
[HeaderBar total badge] re-renders:
  <span role="status" aria-live="off"
        aria-label="Thread total: 1,248 tokens">
    [1,248 tok]
  </span>
```

- Recompute runs only on footer commit (one per terminated assistant turn), not per streamed token; this keeps the HeaderBar stable during streaming per Wireframe 4 and the `HeaderBarTotalMachine` invariant ([Architecture §6 State Ownership](../../../../architecture/architecture.md#6-state-ownership)).
- `aria-live="off"` avoids per-turn announcements on the thread total; the per-message footer already carries the screen-reader signal for that turn ([Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views)).

### 4. `error` and `cancel` terminal events → footer still commits

```
[F02] StreamEvent { type: "error", usage?: {...} }   // or { type: "cancel", ... }
         |
         v
[F07 chat-streaming-stop] routes terminal event
         |
         v
[AssistantBubbleFooter] onTerminalEvent(event)
         |
         v
same branch as `done`:
  - if usage present -> counted(api)
  - else             -> counted(estimate) using the bubble text accumulated
                        up to the error / cancel boundary
         |
         v
React render: same footer template; tokens reflect the partial bubble
```

- Matches AC 4 of [feature.md](./feature.md): every terminated assistant message renders a stable input/output/total triple, including "cancelled after N tools" from [F07](../chat-streaming-stop/feature.md) ([Architecture §5.6 Cancellation](../../../../architecture/architecture.md#56-cancellation)).

### 5. Teardown (bubble unmount, thread switch, plugin unload)

```
onClose / thread switch / onunload
         |
         v
unsubscribe AssistantBubbleFooter from terminal-event hook
clear commit handler reference
HeaderBar useMemo disposes with its parent ChatView
```

- All subscriptions register their unregister fn in the `useEffect` cleanup; no dangling listeners or timers are left behind ([Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules), [Code style — Async & Concurrency](../../../../standards/code-style.md#async--concurrency)).

## Component mapping

| UI block | Platform / lib | Notes |
|---|---|---|
| Assistant-bubble footer span | React `<span role="status" aria-label="Token usage">` rendered by `AssistantBubbleFooter` inside the [F05](../chat-message-list-markdown/feature.md) bubble ([UI Layer — Framework](../../../../standards/tech-stack.md#ui-layer), [Code style — React 18](../../../../standards/code-style.md#react-18)) | Static `role="status"`, not live — no announce on append since the bubble itself is already announced by [F05](../chat-message-list-markdown/feature.md)'s polite log. Keyboard reachable via natural Tab traversal of the enclosing bubble ([Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views)). |
| Terminal `StreamEvent` hook | SSE reader from [Agent Layer](../../../../standards/tech-stack.md#agent-layer); terminal event contract in [Architecture §4 Key Contracts — StreamEvent](../../../../architecture/architecture.md#4-key-contracts) | One subscription per assistant bubble, registered in a single `useEffect` and released on unmount ([Code style — Async & Concurrency](../../../../standards/code-style.md#async--concurrency)). |
| Fallback estimator `Math.ceil(len / 4)` | Pure JS; no libs ([UI Layer — Framework](../../../../standards/tech-stack.md#ui-layer), [Code style — React 18](../../../../standards/code-style.md#react-18)) | Boundary-tested at `len ∈ {0, 1, 4, 5}` per [feature.md](./feature.md) AC 7 ([Code style — Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw)). |
| Estimate marker (`~` prefix, `(est.)` suffix, `aria-label` "(estimated)") | Pure React render over the `source === "estimate"` branch; no extra libs ([UI Layer — Styling](../../../../standards/tech-stack.md#ui-layer)) | Visual + SR marker both applied; SR label does not depend on the `~` glyph so audio users get parity with sighted users ([Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views)). |
| HeaderBar total badge | React `<span role="status" aria-live="off" aria-label="Thread total: N tokens">` slotted into the [F04](../chat-sidebar-view/feature.md) HeaderBar ([UI Layer — Framework](../../../../standards/tech-stack.md#ui-layer)) | Derived via `useMemo` summing `messages[*].total`; recomputes only on footer commit, never per streamed token ([Architecture §6 State Ownership](../../../../architecture/architecture.md#6-state-ownership)). |
| HeaderBar badge collapse at < 280px | Pure CSS via the `data-collapsed` attribute the [F04](../chat-sidebar-view/feature.md) shell already sets on `HeaderBar` ([UI Layer — Styling](../../../../standards/tech-stack.md#ui-layer), [Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)) | `tok` suffix dropped; native `title` attribute preserves full "N tok (thread total)" so no info is lost ([Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views)). |
| Locale thousands separator | `Number.prototype.toLocaleString()` ([Platform APIs](../../../../standards/tech-stack.md#platform-apis)) | Applied to both the footer totals and the HeaderBar badge so `1,248` / `1 248` / `1.248` render per user locale. |
| Obsidian CSS variables for muted color | `color: var(--text-muted)`; `background: var(--background-secondary)`; `border: 1px solid var(--background-modifier-border)` — all from Obsidian's theme tokens ([UI Layer — Styling](../../../../standards/tech-stack.md#ui-layer), [Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)) | No hardcoded colours; theme-aware across light/dark per [Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views). |
| Footer font-size | `font-size: var(--font-ui-smaller)` from Obsidian's native typography scale ([UI Layer — Styling](../../../../standards/tech-stack.md#ui-layer), [Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)) | Matches the "muted companion line" affordance; no custom px values ([Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views)). |
| Reduced-motion gate | `@media (prefers-reduced-motion: reduce)` around the 120ms final-footer fade-in ([Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)) | Under `reduce`, the footer swap is instantaneous; information survives unchanged ([Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views)). |
| Teardown (bubble unmount, thread switch, plugin unload) | React `useEffect` cleanup + `ItemView.onClose` ([Platform APIs](../../../../standards/tech-stack.md#platform-apis), [Code style — Async & Concurrency](../../../../standards/code-style.md#async--concurrency)) | Unsubscribes from the terminal-event hook and clears commit references — enforcing the "no dangling listeners or timers" rule of [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules). |

## Back-link

- [feature.md](./feature.md)
