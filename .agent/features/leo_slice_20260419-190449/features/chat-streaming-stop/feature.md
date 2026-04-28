# F07 — Streaming render & stop control

## Purpose

Turn the completed-turn transcript from [F05](../chat-message-list-markdown/feature.md) and the Esc / stop intent forwarded by the composer in [F06](../chat-composer-input/feature.md) into a live streaming surface: the in-flight assistant turn is appended token-by-token as SSE events arrive from the LM Studio adapter delivered in [F02](../provider-lmstudio-core/feature.md) per [FR-CHAT-04](../../context.md#fr-chat-04), with an animated caret rendered in the streaming visual state per [FR-UI-06](../../context.md#fr-ui-06) and a render pipeline that targets 60fps per [NFR-PERF-05](../../context.md#nfr-perf-05). The same surface exposes a Stop control that triggers an `AbortController`, lets the in-flight tool call (if any) finish atomically while skipping remaining queued tool calls, and surfaces a "cancelled after N tools" indicator in the transcript per [FR-CHAT-05](../../context.md#fr-chat-05); streaming start, stop, and error transitions are announced to assistive tech via an assertive live region per [NFR-USE-08](../../context.md#nfr-use-08).

## Scope

### In scope

- Streaming renderer that consumes `StreamEvent.token` / `usage` / `done` events from the [F02](../provider-lmstudio-core/feature.md) provider and appends tokens to the tail assistant bubble inside the [F05](../chat-message-list-markdown/feature.md) `MessageList` without remounting earlier turns.
- Animated streaming cursor (the `streaming` visual state from [FR-UI-06](../../context.md#fr-ui-06)) rendered at the tail of the in-flight assistant bubble; cursor collapses to a static terminal state on `done`, `error`, or cancel.
- Render pipeline tuned for the 60fps target of [NFR-PERF-05](../../context.md#nfr-perf-05): token buffering and `requestAnimationFrame`-driven flushes, stable message keys so React only reconciles the tail bubble, and no layout thrash against the scroll anchor from [F05](../chat-message-list-markdown/feature.md).
- Stop control (send-button swap to stop glyph while streaming, plus the Esc route forwarded by [F06](../chat-composer-input/feature.md)) wired to a single `AbortController` per turn; aborting signals the provider stream and any tool-running slot so the in-flight tool finishes atomically and remaining queued tool calls are skipped per [FR-CHAT-05](../../context.md#fr-chat-05).
- "Cancelled after N tools" indicator appended to the transcript when the turn terminates via Stop, with N sourced from the tool-run counter for the turn.
- Assertive `aria-live="assertive"` live region (distinct from the polite message-log announcer in [F05](../chat-message-list-markdown/feature.md)) that announces "streaming started", "streaming stopped" / "cancelled after N tools", and streaming errors per [NFR-USE-08](../../context.md#nfr-use-08).
- Unit coverage for: token append order and keyed reconciliation; `requestAnimationFrame` batching under burst input; Stop via button and via Esc both triggering the same `AbortController`; "cancelled after N tools" message content reflecting the tool counter; assertive-live-region messages emitted on start / stop / error; cursor suppressed when `prefers-reduced-motion` is set.

### Out of scope

- Tool invocations, `tool_call` / `tool_confirmation` stream events, tool-running spinner content, and the per-tool allowlist — ship with F16+ (this feature only reads the tool counter and renders the cancellation indicator).
- FIFO queue for user messages submitted during an in-flight turn — ships with F11.
- Message persistence to `.leo/conversations/` for completed and cancelled turns — ships with F14.
- Autocompaction, microcompaction, partial compaction, and the compaction boundary marker — ship with F42+.

## Acceptance criteria

1. While the provider streams, the tail assistant bubble in the [F05](../chat-message-list-markdown/feature.md) `MessageList` grows token-by-token as `StreamEvent.token` events arrive from [F02](../provider-lmstudio-core/feature.md), with earlier completed messages unchanged and React re-rendering only the tail bubble. (FR-CHAT-04)
2. The in-flight assistant bubble renders an animated streaming cursor at its tail while the stream is open, matching the `streaming` visual state; the cursor disappears on the terminal `done` event and on any cancel / error exit. (FR-UI-06)
3. Under a burst token stream (simulated high arrival rate in the unit suite), the renderer batches DOM writes through `requestAnimationFrame` so that frame budget stays within the 60fps target and no per-token synchronous layout occurs. (NFR-PERF-05)
4. Pressing Stop (button) or Esc (via the [F06](../chat-composer-input/feature.md) Esc route) aborts the shared `AbortController`: the provider stream terminates, any in-flight tool call is allowed to finish atomically, any remaining queued tool calls are skipped, and no further tokens append to the bubble. (FR-CHAT-05)
5. When a turn terminates via Stop, the transcript shows a "cancelled after N tools" indicator where N equals the number of tool calls completed during that turn (0 if the stop happened before any tool ran). (FR-CHAT-05, FR-UI-06)
6. An assertive `aria-live="assertive"` region announces "streaming started" on stream open, "streaming stopped" (or the "cancelled after N tools" string) on cancel, and an error message on stream error — distinct from the polite message-log announcer owned by [F05](../chat-message-list-markdown/feature.md). (NFR-USE-08)
7. Unmounting the chat view (pane close, plugin disable, thread switch) aborts any in-flight stream via the same `AbortController`, tears down the animation frame loop and live-region element, and leaves no dangling listeners or timers. (FR-CHAT-04, FR-CHAT-05)

## Dependencies

- [F05 chat-message-list-markdown](../chat-message-list-markdown/feature.md) — supplies the transcript surface, stable message keys, scroll anchor, and polite `role="log"` announcer this feature streams into without disturbing.
- [F06 chat-composer-input](../chat-composer-input/feature.md) — supplies the Esc precedence contract and the send-button slot that swaps to the Stop glyph while a turn is in flight.
- [F02 provider-lmstudio-core](../provider-lmstudio-core/feature.md) — emits the `StreamEvent.token` / `usage` / `done` events consumed here and honours the `AbortController` signal propagated from this feature.
- Drives requirements [FR-CHAT-04](../../context.md#fr-chat-04), [FR-CHAT-05](../../context.md#fr-chat-05), [FR-UI-06](../../context.md#fr-ui-06), [NFR-PERF-05](../../context.md#nfr-perf-05), [NFR-USE-08](../../context.md#nfr-use-08).

## Implementation notes

- [Architecture §3.1 UI Layer — ChatView](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) hosts the streaming surface.
- [Architecture §4 Key Contracts — StreamEvent / AgentRunner](../../../../architecture/architecture.md#4-key-contracts) fixes the token event shape.
- [Architecture §5.2 Chat Turn (no tools)](../../../../architecture/architecture.md#52-chat-turn-no-tools) and [§5.6 Cancellation](../../../../architecture/architecture.md#56-cancellation) anchor the stream-and-stop flow and "cancelled after N tools" return.
- [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) mandates the single `AbortController` teardown AC7 enforces.
- [Tech stack — UI Layer](../../../../standards/tech-stack.md#ui-layer) and [Agent Layer](../../../../standards/tech-stack.md#agent-layer) pin React 18 and the SSE client.
- [Code style — React 18](../../../../standards/code-style.md#react-18), [Async & Concurrency](../../../../standards/code-style.md#async--concurrency), [Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian), [Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw).
- [Best practices — Core Principles](../../../../standards/best-practices.md#core-principles).

## Open questions

- None. Acceptance criteria and implementation notes exhaust this feature's scope; no decisions are deferred at this slice.
