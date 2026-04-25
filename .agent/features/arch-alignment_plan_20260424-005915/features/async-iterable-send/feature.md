# F07 — AgentRunner.send returns AsyncIterable

## Purpose

Change the public `AgentRunner.send(msg, thread)` signature to return `AsyncIterable<StreamEvent>` per [architecture.md § 4](../../../../architecture/architecture.md#4-key-contracts) — see [context.md § Runtime orchestration / FR-04](../../context.md#runtime-orchestration). Replace or wrap the current push-based `EventChannel` at the public boundary.

## Scope

In scope:
- Update `AgentRunner.send()` return type to `AsyncIterable<StreamEvent>`.
- Provide a generator-based adapter over `EventChannel` (or ditch EventChannel entirely and pull straight from `graph.stream()`).
- Migrate `ChatView` and [`src/ui/chat/turnDispatcher.ts`](../../../../../src/ui/chat/turnDispatcher.ts) to `for await (const ev of ar.send(...))` consumption.
- Migrate all tests that currently pump the EventChannel (`tests/unit/agentRunner.test.ts`, live tests) to the `for await` pattern.
- Keep `AgentRunner.cancel(thread)` and `AgentRunner.queueLength()` signatures unchanged.

Out of scope:
- Internal graph implementation (F04 scope).
- Stream event variant set (F06 scope).
- UI visual changes.

## Acceptance criteria

1. `AgentRunner.send(msg, thread): AsyncIterable<StreamEvent>` — type matches [architecture.md § 4 `AgentRunner`](../../../../architecture/architecture.md#4-key-contracts). (FR-04)
2. No UI or test file constructs or subscribes to an `EventChannel` directly. (FR-04)
3. Cancellation via `AgentRunner.cancel(thread)` causes the async iterator to exit cleanly after emitting a final `done` event with cancelled flag. (NFR-01, NFR-05)
4. Back-pressure: if the consumer pauses `await`-ing, provider streaming must not buffer unboundedly — document the buffering strategy in the PR. (NFR-03)
5. Full Vitest suite green in the same commit that flips the return type. (NFR-05)

## Dependencies

- [F06 — stream-event-union](../stream-event-union/feature.md)
- [../../context.md § Runtime orchestration](../../context.md#runtime-orchestration)
- [../../features-index.md](../../features-index.md) row F07

## Implementation notes

- API target — [architecture.md § 4 AgentRunner interface](../../../../architecture/architecture.md#4-key-contracts).
- Concurrency constraints — [architecture.md § 10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) ("Single AgentRunner", "FIFO queue", "AbortController").
- Style — [code-style.md](../../../../standards/code-style.md).
- Incremental delivery / single-PR type flips — [best-practices.md](../../../../standards/best-practices.md).

## Open questions

1. Keep `EventChannel` as an internal utility for tests / plan-mode observers, or delete outright? Default: keep internal, not exported.
2. Should the async iterable be re-iterable (`Symbol.asyncIterator` returning new iterators) or single-shot? Default: single-shot — matches graph.stream semantics and FR-AGENT-07 one-in-flight rule.
