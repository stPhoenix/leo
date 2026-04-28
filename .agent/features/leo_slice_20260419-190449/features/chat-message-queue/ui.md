# F11 — FIFO user-message queue · UI

## Layout

All wireframes render inside the `ComposerInput` region reserved by [F04 chat-sidebar-view](../chat-sidebar-view/feature.md) and the `MessageList` region owned by [F05 chat-message-list-markdown](../chat-message-list-markdown/feature.md). This feature adds two observable surfaces: (1) a **queued-status badge** beside the send button inside `ComposerInput`, and (2) **muted pending bubbles** appended to the transcript tail for user messages that sit in the `AgentRunner` FIFO queue ([Architecture §3.2 Agent Layer](../../../../architecture/architecture.md#32-agent-layer), [Architecture §4 Key Contracts](../../../../architecture/architecture.md#4-key-contracts)). Icons come from [`setIcon`](../../../../standards/tech-stack.md#platform-apis) on Obsidian's bundled Lucide set ([UI Layer — Icons](../../../../standards/tech-stack.md#ui-layer)); colours, borders, and focus rings resolve exclusively through Obsidian CSS variables ([UI Layer — Styling](../../../../standards/tech-stack.md#ui-layer), [Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)).

### Wireframe 1 — Composer while a prior request is in-flight, N queued (`queueLength == 2`)

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|
┌─────────────────────────────────────────────────┐
│ ComposerInput                                   │   region, rendered by ChatView
├─────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────┐ ┌──┐│
│ │ (textarea stays focusable; next message │ │[]││   ■ = setIcon("square") stop
│ │  queues on Enter)                       │ │  ││     glyph inherited from F07
│ └─────────────────────────────────────────┘ └──┘│
│  ┌──────────────┐                                │
│  │ ⏳ 2 queued  │   ← badge: setIcon("clock")     │   beside send button,
│  └──────────────┘      + count, role="status",   │   aria-live="polite"
│                        fg: var(--text-muted)     │
│                        bg: var(--background-secondary)
└─────────────────────────────────────────────────┘
```

- Badge renders only when `AgentRunner.queueLength > 0`; it is a native `<span role="status" aria-live="polite">` so assistive tech announces the count as it changes without stealing focus ([Architecture §4 Key Contracts](../../../../architecture/architecture.md#4-key-contracts), [Code style — React 18](../../../../standards/code-style.md#react-18)).
- The clock glyph is painted by [`setIcon("clock")`](../../../../standards/tech-stack.md#platform-apis); colour / background are `var(--text-muted)` / `var(--background-secondary)` — no hardcoded hex ([Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)).
- The composer's in-flight visual (stop glyph + readonly-feel textarea) is inherited wholesale from [F06 ui.md Wireframe 5](../chat-composer-input/ui.md); this feature adds only the queued-status badge.

### Wireframe 2 — Transcript showing muted pending user bubbles (tail of `MessageList`)

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|
┌─────────────────────────────────────────────────┐
│ MessageList (F05)                               │
│                                                 │
│ ┌─────────────────────────────────────────────┐ │
│ │ you · 14:03                                 │ │
│ │ Summarise the highlighted section.          │ │   dispatched, normal style
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ ┌─────────────────────────────────────────────┐ │
│ │ leo · 14:03                                 │ │
│ │ The highlighted section is about...▋        │ │   ← streaming (F07 cursor)
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ ┌─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┐│   dashed = pending bubble
│ │ you · queued                               ⏳ ││   fg: var(--text-muted)
│ │ Now turn it into a bullet list.             ││   opacity: 0.7
│ └─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘│   aria-label="Queued message"
│                                                 │
│ ┌─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┐│
│ │ you · queued                               ⏳ ││   second pending bubble,
│ │ And keep terms consistent with the guide.   ││   FIFO order preserved
│ └─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘│
└─────────────────────────────────────────────────┘
```

- Pending bubbles re-use the user-message shell shipped by [F05 ui.md](../chat-message-list-markdown/ui.md) and add a `data-pending="true"` attribute that gates the muted style (`opacity: 0.7`, dashed border, `fg: var(--text-muted)`) ([Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)).
- The clock glyph in each pending bubble is the same [`setIcon("clock")`](../../../../standards/tech-stack.md#platform-apis) used by the composer badge so the "queued" affordance is visually consistent across the two surfaces ([UI Layer — Icons](../../../../standards/tech-stack.md#ui-layer)).
- Pending bubbles are appended in arrival order and removed head-first as `AgentRunner` dequeues — the transcript mirrors the runner's FIFO invariant per [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules).
- Each pending bubble carries `aria-label="Queued message"` so assistive tech distinguishes it from dispatched user turns; no colour-only signal ([Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views)).

### Wireframe 3 — Empty queue (`queueLength == 0`), no hint rendered

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|
┌─────────────────────────────────────────────────┐
│ ComposerInput                                   │
├─────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────┐ ┌──┐│
│ │ Type a message...                       │ │▶ ││   send: setIcon("send"),
│ │                                         │ │  ││   idle, no badge
│ └─────────────────────────────────────────┘ └──┘│
│                                                 │   ← no "N queued" row;
│                                                 │     DOM node unmounted
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ MessageList (F05)                               │
│                                                 │
│ ┌─────────────────────────────────────────────┐ │
│ │ leo · 14:03                                 │ │
│ │ ...final bullet item. (turn complete)       │ │   no pending bubbles
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

- When `queueLength === 0` the badge component returns `null` from its render body so React unmounts the DOM subtree entirely — no zero-state placeholder, no residual count ([Code style — React 18](../../../../standards/code-style.md#react-18); [feature.md acceptance criteria 4](./feature.md#acceptance-criteria)).
- The transcript has no pending bubbles because the `AgentRunner` queue is drained; the `MessageList` tail shows only dispatched user turns and the final assistant reply ([Architecture §5.2 Chat Turn (no tools)](../../../../architecture/architecture.md#52-chat-turn-no-tools)).
- A re-mount of `ChatView` (pane close / re-open) reads fresh `queueLength` from the `AgentRunner` singleton; no stale indicator state survives teardown ([Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules); [feature.md acceptance criteria 5](./feature.md#acceptance-criteria)).

## State machine

Two parallel machines describe this feature: the **queue lifecycle** (owned by `AgentRunner`, surfaced read-only to the UI) and the **composer awaiting-response** view state (derived from `queueLength` plus the in-flight stream state from [F07](../chat-streaming-stop/feature.md)). Both machines are pure derivations — no local flags — per [Code style — React 18](../../../../standards/code-style.md#react-18).

### Queue lifecycle: `empty → buffering(N>0) → draining → empty`

```
         ┌────────────────────────────────────┐
         │                                    │
         │          enqueue(m)                │
         │      while in-flight               │
         v                                    │
    ┌─────────┐                          ┌────┴────────┐
    │  empty  │───── enqueue(m) ────────▶│ buffering   │
    │ (N=0)   │      while in-flight     │ (N > 0)     │
    └─────────┘                          └──────┬──────┘
         ▲                                      │
         │                                      │ in-flight turn
         │ queueLength reaches 0                │ terminal event
         │                                      │ (done/error/cancel)
         │                                      v
         │                              ┌────────────────┐
         │  head dispatched &           │    draining    │
         └──────── N decrements ────────┤ dequeue head,  │
                                        │ send to runner │
                                        └────────────────┘
                                              │    ▲
                                              │    │
                                              └────┘
                                      another terminal
                                      event & N > 0
                                      (self-loop until drain)
```

- Transitions are driven entirely by `AgentRunner` terminal stream events (`done` / `error` / `cancel`); the UI only reads `queueLength` and re-renders — it never calls `enqueue` or `dequeue` directly ([Architecture §5.6 Cancellation](../../../../architecture/architecture.md#56-cancellation), [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules)).
- `cancel` preserves the remaining queue (per [feature.md acceptance criteria 3](./feature.md#acceptance-criteria)): the head was the in-flight message and is already removed; subsequent queued messages stay intact for the next terminal event to drain.
- `empty → empty` self-loop on idle submit is handled by the normal (non-queued) chat-turn path from [F06](../chat-composer-input/feature.md) / [F10](../agent-controller-core/feature.md) — no queue state change.

### Composer awaiting-response: `idle → awaiting-response(with N queued)`

```
    ┌──────────┐                           ┌───────────────────────────┐
    │   idle   │───── submit(text) ───────▶│  awaiting-response        │
    │          │      & no in-flight       │  (N = queueLength)        │
    └──────────┘                           │  - stop glyph visible     │
         ▲                                 │  - badge visible iff N>0  │
         │                                 └──────┬────────────────────┘
         │                                        │
         │                                        │ enqueue(m) while
         │                                        │ in-flight
         │                                        │   N += 1 (badge re-renders)
         │                                        │
         │                                        │ terminal event &
         │ terminal event & N==0                  │ N > 0 (drain step)
         │                                        │   N -= 1 (badge re-renders)
         └────────────────────────────────────────┘
```

- The `awaiting-response` state is a pure derivation of `AgentRunner.inFlight === true`; the composer reads this through the same subscription that feeds `queueLength` ([Architecture §4 Key Contracts](../../../../architecture/architecture.md#4-key-contracts)).
- Badge visibility inside `awaiting-response` is `queueLength > 0`; the transition from `awaiting-response(N=0)` back to `idle` fires on the final terminal event when `queueLength === 0` after dispatch.
- Reduced-motion: badge enter/exit uses no transition under `@media (prefers-reduced-motion: reduce)` — the count changes instantaneously, matching the composer-wide motion contract from [F06 ui.md](../chat-composer-input/ui.md) ([Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)).

## Event flow

### 1. User presses Enter while streaming → enqueue + muted bubble + badge increments

1. [F06 chat-composer-input](../chat-composer-input/feature.md) dispatches `submit(text)` on `Enter` (no Shift, `!event.isComposing`); the textarea clears immediately per [F06 ui.md event flow #2](../chat-composer-input/ui.md).
2. The `submit` callback is wired to `AgentRunner.send(msg, thread)` ([Architecture §4 Key Contracts](../../../../architecture/architecture.md#4-key-contracts)); because an in-flight turn exists, the runner appends the message to its in-memory FIFO queue rather than starting a new turn ([Architecture §5.2 Chat Turn (no tools)](../../../../architecture/architecture.md#52-chat-turn-no-tools), [feature.md acceptance criteria 1](./feature.md#acceptance-criteria)).
3. `AgentRunner` emits a `queueChanged` notification (a small `Observable<number>` / tiny pub-sub of `queueLength`); React components subscribe in a `useEffect` ([Code style — React 18](../../../../standards/code-style.md#react-18)).
4. The composer badge re-renders with the new count via `setIcon("clock")` + a numeric text node inside `role="status" aria-live="polite"` so the change is announced without stealing focus ([Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views)).
5. `MessageList` (owned by [F05](../chat-message-list-markdown/feature.md)) also subscribes to the queue view; it appends a pending bubble at the tail with `data-pending="true"`, which drives the muted styling via Obsidian CSS variables (no custom colour) ([Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)).
6. Queue machine moves `empty → buffering(N=1)` or `buffering(N) → buffering(N+1)`.

### 2. In-flight request completes → dequeue head + dispatch + badge decrements

1. The `AsyncIterable<StreamEvent>` consumed by [F07 chat-streaming-stop](../chat-streaming-stop/feature.md) emits a terminal event: `done` (success), `error` (provider failure), or `cancel` (user abort via Esc / Stop button) ([Tech stack — Agent Layer](../../../../standards/tech-stack.md#agent-layer), [Architecture §5.6 Cancellation](../../../../architecture/architecture.md#56-cancellation)).
2. Inside `AgentRunner`, the terminal handler checks `queue.length`; if non-zero it calls `queue.shift()` and immediately invokes `send(head, thread)` to start the next turn without any fresh user action ([feature.md acceptance criteria 3](./feature.md#acceptance-criteria); [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules)).
3. `queueChanged` fires with the new `queueLength` (N-1).
4. The composer badge re-renders: if `queueLength > 0` the count decrements; if `queueLength === 0` the badge component returns `null` and its DOM node is unmounted.
5. `MessageList` removes the head pending bubble (dashed, muted) and re-renders it as a normal dispatched user message; the new in-flight assistant bubble appears below it with the [F07](../chat-streaming-stop/feature.md) streaming cursor.
6. Queue machine moves `buffering(N) → draining → buffering(N-1)` or `buffering(1) → draining → empty` on final drain.

### 3. User-initiated cancel → queue preserved for next turn

1. User presses Esc or clicks the stop button; [F07 chat-streaming-stop](../chat-streaming-stop/feature.md) calls `AbortController.abort()` on the in-flight turn ([Architecture §5.6 Cancellation](../../../../architecture/architecture.md#56-cancellation)).
2. The stream emits `cancel` as its terminal event; `AgentRunner`'s terminal handler runs the same dequeue-and-dispatch path as `done` / `error` ([feature.md acceptance criteria 3](./feature.md#acceptance-criteria)).
3. The queue is **preserved** — only the in-flight turn (already removed from the queue when it started) is cancelled; the remaining queued messages stay intact and flush into the next terminal event in FIFO order ([feature.md#scope](./feature.md#scope), ["In scope" bullet on auto-flush]).
4. Composer badge and `MessageList` pending bubbles update identically to the `done` path; from the UI's perspective, `cancel` is just another trigger that decrements `queueLength` by one (via the immediate next-turn dispatch).

### 4. Teardown (pane close, plugin disable, thread switch)

1. `ChatView.onClose` invokes `useEffect` cleanup on the badge and any `MessageList` pending-bubble subscription; each returns an unsubscribe that removes its `queueChanged` listener from `AgentRunner` ([Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules)).
2. The badge DOM node is removed by React as part of `createRoot().unmount()` ([UI Layer — Framework](../../../../standards/tech-stack.md#ui-layer)); no dangling listeners survive ([feature.md acceptance criteria 5](./feature.md#acceptance-criteria)).
3. A re-mount (pane re-open) reads a fresh `queueLength` snapshot from `AgentRunner` and re-subscribes; no stale indicator state is possible because the component owns no persistent local state — all reads go through the runner ([Architecture §6 State Ownership](../../../../architecture/architecture.md#6-state-ownership)).

## Component mapping

| UI block | Obsidian / React component | Standards reference |
|---|---|---|
| `Queue<Msg>` store | In-memory FIFO array on `AgentRunner` with `enqueue` / `dequeue` / `queueLength` readout; UI subscribes read-only | [Architecture §3.2 Agent Layer](../../../../architecture/architecture.md#32-agent-layer); [Architecture §4 Key Contracts](../../../../architecture/architecture.md#4-key-contracts); [Tech stack — Agent Layer](../../../../standards/tech-stack.md#agent-layer) |
| `queueLength` subscription | Tiny pub-sub (`on('queueChanged', cb)`) consumed via `useEffect` with cleanup; no React Context, no global store | [Code style — React 18](../../../../standards/code-style.md#react-18); [Architecture §6 State Ownership](../../../../architecture/architecture.md#6-state-ownership) |
| Composer badge glyph | Obsidian [`setIcon("clock")`](../../../../standards/tech-stack.md#platform-apis) painted into a `<span>` next to the count; Lucide name inherited from Obsidian's bundled set | [UI Layer — Icons](../../../../standards/tech-stack.md#ui-layer); [Platform APIs](../../../../standards/tech-stack.md#platform-apis) |
| Composer badge element | Native `<span role="status" aria-live="polite">` containing the glyph + count + `"queued"` label; renders only when `queueLength > 0` | [Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views); [Code style — React 18](../../../../standards/code-style.md#react-18) |
| Muted pending-bubble style | Obsidian CSS variables `var(--text-muted)` / `var(--background-secondary)` plus `opacity: 0.7` and a dashed `1px` border gated by `data-pending="true"`; zero hardcoded colours | [UI Layer — Styling](../../../../standards/tech-stack.md#ui-layer); [Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) |
| Pending-bubble shell | Re-uses the user-message bubble shipped by [F05 chat-message-list-markdown](../chat-message-list-markdown/feature.md) with an extra `aria-label="Queued message"`; no markdown post-processing runs on queued drafts (raw text until dispatch) | [Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views); [Architecture §5.2 Chat Turn (no tools)](../../../../architecture/architecture.md#52-chat-turn-no-tools) |
| Pending-bubble icon | [`setIcon("clock")`](../../../../standards/tech-stack.md#platform-apis) painted inline with the author row so the affordance matches the composer badge | [UI Layer — Icons](../../../../standards/tech-stack.md#ui-layer) |
| Terminal-event hook | `AsyncIterable<StreamEvent>` consumed by [F07](../chat-streaming-stop/feature.md); `AgentRunner` listens for `done` / `error` / `cancel` and runs the dequeue-and-dispatch step | [Tech stack — Agent Layer](../../../../standards/tech-stack.md#agent-layer); [Architecture §5.6 Cancellation](../../../../architecture/architecture.md#56-cancellation); [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) |
| Reduced-motion gate | `@media (prefers-reduced-motion: reduce)` suppresses badge fade-in / fade-out and pending-bubble dash animation; state changes still apply, just instantly | [Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) |
| Keyboard reachability | Badge and pending bubbles are **non-interactive** (`<span>` / no `tabindex`), so they do not add Tab stops and do not alter the composer's Tab order defined by [F06 ui.md](../chat-composer-input/ui.md) | [Code style — React 18](../../../../standards/code-style.md#react-18); [Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) |
| Listener teardown on unmount | `useEffect` cleanup removes every `queueChanged` listener; `createRoot().unmount()` tears down the DOM; no dangling handlers | [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules); [Code style — Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| Unit tests (enqueue while streaming, FIFO order across N, auto-flush on each terminal event, badge visibility tied to `queueLength`, indicator teardown on unmount) | Vitest + jsdom | [Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw); [Tech stack — Testing](../../../../standards/tech-stack.md#testing) |

Accessibility invariants for this feature ([feature.md#acceptance-criteria](./feature.md#acceptance-criteria) and the shell-wide invariants established by [F04 ui.md](../chat-sidebar-view/ui.md)):

- Badge and pending bubbles add **no new Tab stops**; the composer's keyboard traversal from [F06 ui.md](../chat-composer-input/ui.md) is unchanged ([Code style — React 18](../../../../standards/code-style.md#react-18)).
- The queued-status badge is announced via `role="status" aria-live="polite"` so assistive tech reads "N queued" without stealing focus; pending bubbles are distinguished from dispatched user messages by `aria-label="Queued message"` — colour is never the sole signal ([Architecture §3.1 UI Layer](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views)).
- `prefers-reduced-motion: reduce` suppresses badge fade-in / fade-out and any pending-bubble transition; state changes still apply instantly ([Code style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian)).
- All colours, borders, and the pending-bubble opacity resolve through Obsidian CSS variables; a style-audit Vitest asserts zero hardcoded hex values inside this feature's stylesheet ([UI Layer — Styling](../../../../standards/tech-stack.md#ui-layer)).

## Back-link

[← feature.md](./feature.md)
