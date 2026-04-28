# F11 — FIFO user-message queue

## Purpose

Surface the FIFO user-message queue behaviour to the chat UI so that any message the user submits through the [F06 chat-composer-input](../chat-composer-input/feature.md) while a prior request is still in flight on the [F10 agent-controller-core](../agent-controller-core/feature.md) `AgentRunner` is enqueued in arrival order rather than dropped or silently sent, and then auto-flushed in FIFO order as soon as the in-flight turn completes (`done` / `error` / `cancel`), with the composer rendering a visible queued-status indicator so the user can see pending submissions accumulate and drain without guessing at runner state per [FR-CHAT-10](../../context.md#fr-chat-10).

## Scope

### In scope

- FIFO enqueue of user-submitted messages into the [F10](../agent-controller-core/feature.md) `AgentRunner` queue whenever a prior request is in flight per [FR-CHAT-10](../../context.md#fr-chat-10); the composer's `submit(text)` callback routes to `AgentRunner.send(msg, thread)` and is accepted regardless of in-flight state.
- Auto-flush: on the in-flight turn's `done` / `error` / `cancel`, the runner dequeues the next pending message and starts its turn without further user action, preserving arrival order across the full queue.
- `ComposerInput` queued-status indicator (e.g. inline badge / hint beneath the send button) that renders when `AgentRunner.queueLength > 0`, shows the count of pending messages, and clears as the queue drains, giving the user observable feedback that submissions are waiting.
- Empty-draft clearing on enqueue so the textarea becomes available for the next draft immediately after submit, matching the composer contract established in [F06](../chat-composer-input/feature.md).
- Unit coverage for: submit-while-streaming enqueues (not drops), FIFO order preservation across N queued messages, auto-flush on each terminal event of the in-flight turn, queued-status indicator visibility tied to `queueLength`, and indicator teardown on unmount.

### Out of scope

- Multi-thread / per-thread queue management and thread switching semantics → ship with F37 (`thread-management`).
- Persistence of queued messages across plugin reload or crash → ships with F14 (`conversation-store-persistence`); this feature keeps the queue in memory only, consistent with [F10](../agent-controller-core/feature.md).
- Compaction hand-off (what happens to queued messages while a `CompactionEngine` call is in flight) → ships with F42+; the context.md open question on queue-during-compaction remains deferred.
- Streaming-cursor rendering, Stop mechanics, and cancel-after-N-tools banner → owned by F07 (`chat-streaming-stop`); this feature only observes terminal events to trigger flush.
- Token / cost accounting for queued-but-not-yet-sent messages → owned by F12.
- Reordering, editing, or cancelling individual queued entries from the UI — not in SRS scope for phase 1.

## Acceptance criteria

1. A user message submitted via [F06 chat-composer-input](../chat-composer-input/feature.md) while a prior `AgentRunner` turn is in flight is enqueued into the runner's FIFO queue and is not dropped, not sent concurrently, and not merged with any other draft. (FR-CHAT-10)
2. When multiple messages are submitted during a single in-flight turn, they are dequeued and dispatched to `AgentRunner.send` in strict arrival order (first-in, first-out); a test submitting messages `m1, m2, m3` while one turn streams observes the runner start turns for `m1 → m2 → m3` in that order and never out of sequence. (FR-CHAT-10)
3. On each terminal event of the in-flight turn (`done`, `error`, or user-initiated `cancel`), the runner automatically starts the next queued message's turn without requiring a fresh user action; the queue drains fully once the in-flight sequence terminates and no new messages arrive. (FR-CHAT-10)
4. The `ComposerInput` renders a visible queued-status indicator whenever `AgentRunner.queueLength > 0`, shows a count (or equivalent affordance) of pending messages, updates reactively as messages enqueue and drain, and is removed from the DOM when the queue reaches zero. (FR-CHAT-10)
5. Unmounting the chat view (pane close, plugin disable) removes the queue-status subscription and leaves no dangling listeners or stale indicator state; a re-mount reads fresh `queueLength` from the runner. (FR-CHAT-10)

## Dependencies

- [F10 agent-controller-core](../agent-controller-core/feature.md) — provides the `AgentRunner` singleton, its in-memory FIFO queue, `send(msg, thread)` entry point, terminal stream events, and the `queueLength` readout this feature surfaces per [FR-AGENT-07](../../context.md#fr-agent-07).
- [F06 chat-composer-input](../chat-composer-input/feature.md) — provides the `ComposerInput` component, its `submit(text)` callback, and the region where the queued-status indicator renders per [FR-CHAT-03](../../context.md#fr-chat-03).
- Drives requirement [FR-CHAT-10](../../context.md#fr-chat-10).

## Implementation notes

- [Architecture §3.2 Agent Layer](../../../../architecture/architecture.md#32-agent-layer) — places the FIFO queue on `AgentRunner`; this feature exposes it to the UI.
- [Architecture §4 Key Contracts](../../../../architecture/architecture.md#4-key-contracts) — pins `AgentRunner.queueLength` as the readout the composer indicator consumes.
- [Architecture §5.2 Chat Turn (no tools)](../../../../architecture/architecture.md#52-chat-turn-no-tools) — canonical user-submission path that this queue intercepts when the runner is busy.
- [Architecture §6 State Ownership](../../../../architecture/architecture.md#6-state-ownership) — queue lives in-memory on `AgentRunner`; no persistence here.
- [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) — one in-flight, FIFO queue, unload cancels; this feature honours all three.
- [Architecture §11 SRS FR → Modules](../../../../architecture/architecture.md#11-mapping-srs-fr--modules) — routes FR-CHAT-10 to `ChatView` + `AgentRunner`.
- [Tech stack — Agent Layer](../../../../standards/tech-stack.md#agent-layer) — fixes the `AsyncIterable<StreamEvent>` surface whose terminal events trigger flush.
- [Tech stack — UI Layer](../../../../standards/tech-stack.md#ui-layer) — selects React 18 for the reactive queued-status indicator.
- [Code style — React 18](../../../../standards/code-style.md#react-18) — governs subscription + effect cleanup for the `queueLength` readout.
- [Code style — Async & Concurrency](../../../../standards/code-style.md#async--concurrency) — dictates FIFO primitives and non-blocking enqueue.
- [Code style — Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw) — harness for the enqueue / FIFO / auto-flush / indicator suite.
- [Best practices — Core Principles](../../../../standards/best-practices.md#core-principles) — "one in-flight, serial tools" invariant this feature makes user-visible.

## Open questions

- None. Acceptance criteria and implementation notes exhaust this feature's scope; no decisions are deferred at this slice.
