# Impl iteration 1 — F07 async-iterable-send

## Summary

Flipped `AgentRunner.send` from the old `send(input: TurnInput): AsyncIterable<StreamEvent>` single-object signature to the architectural `send(msg: UserMessage, thread: ThreadRef): AsyncIterable<StreamEvent>` two-arg form (architecture.md §4). Return type already matched (F06 aligned `StreamEvent`); this iteration finishes the public-surface alignment and migrates every caller — `src/main.ts` and all Vitest suites — in the same commit. Internally the method still builds a `TurnSlot` around an `EventChannel<StreamEvent>` and returns `events.iterable()`; `EventChannel` remains an internal implementation detail not exported from `@/agent/agentRunner` (Open-Q1 default). No UI or test file constructs or observes an `EventChannel` — all consumption is `for await (const ev of runner.send(...))` or `collect(runner.send(...))`.

## Files touched

- `src/agent/agentRunner.ts` — `send(msg, thread)` signature; body wraps `{ thread, message: msg }` into the internal `TurnSlot.input`. `TurnInput` type kept internal to avoid churn on tests that don't need it.
- `src/main.ts` — `streamStarter` calls `this.agentRunner.send({ role: 'user', content: prompt }, thread)` (positional args).
- `tests/unit/agentRunner.test.ts` — bulk-rewritten via `perl -i -pe` across 28 call sites; one manual fix-up for a multiline `runner.send({...})` block that the regex didn't match.
- `tests/unit/agentRunner.microcompact.test.ts` — 2 call sites rewritten by the same perl pass.
- `tests/llm/agent.live.test.ts` — single call site hand-edited.

## Tests added or updated

No new test files. The 22 + 2 existing agentRunner tests plus the live suite run against the new signature. 1095/1095 pass.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

1. **`TurnInput` type retained internally** (not removed). It still exists in `src/agent/types.ts` because `TurnSlot` uses it and a handful of peripheral types (`TurnSnapshot`) extend it. No public API surfaces it. Could be collapsed away in a later cleanup if `TurnSnapshot` is also pruned.

## Back-pressure notes

`graph.invoke` awaits on the provider stream inside `callModelNode`; provider events are transformed and pushed into the turn's `EventChannel` synchronously. If the async-iterable consumer stops pulling, `EventChannel.pending[]` accumulates — no bounded buffer. In practice this is fine: the single in-flight turn (`FIFO queue`, one active graph invocation) means the producer rate is ≈ network token rate (~100s/sec), and consumers are the rAF-scheduled streaming controller or test `for await` loops that drain in sub-ms. A bounded back-pressure mechanism (e.g. pause provider stream when pending exceeds N) would cost a sync-to-async hop per event and complicate cancellation — deferred until a specific regression warrants it (see arch §10 "AbortController" — cancellation is the hard stop, not back-pressure). Documented here per AC4.

## Assumptions

1. **`msg: UserMessage` matches `AgentUserMessage`** (`{ role: 'user'; content: string }`). Same shape as arch §4 `UserMessage`; reusing the local type keeps imports tidy.
2. **Single-shot async iterable is acceptable.** Per Open-Q2 default — `graph.stream()` + `EventChannel.iterable()` are both single-shot; callers that need to replay must cache.

## Open questions

1. Delete `USE_GRAPH_RUNTIME` + the `plugin.load` `graphRuntime` field? It was a F04 safety net, no longer serves any purpose. Leaving for F08 bundle/metadata pass to decide.
