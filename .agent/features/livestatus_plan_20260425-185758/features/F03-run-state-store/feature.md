# F03 — Run-state store

## Purpose

Introduce a per-thread store tracking tool-use lifecycle state (`queued / running / resolved / errored / rejected / canceled`), progress events keyed by `tool_use_id`, and pending permission requests. Read by renderers via `useSyncExternalStore`; mutated only by `AgentRunner` and tool runners. Separating run state from message state avoids re-rendering unrelated bubbles when a single tool's status flips. Covers [FR-04](../../context.md#functional-requirements), [FR-05](../../context.md#functional-requirements), [NFR-03](../../context.md#non-functional-requirements), [NFR-09](../../context.md#non-functional-requirements), [NFR-11](../../context.md#non-functional-requirements). No UI of its own — F04/F05/F06/F08/F11 read from it.

## Scope

In scope:
- New module `src/chat/runStateStore.ts`. Public surface: `RunStateStore` class + `RunState` type + pure `statusOf(state, toolUseId)` selector.
- Mutator API: `markRunning(id)`, `markResolved(id, isError)`, `markRejected(id)`, `markCanceled(id)`, `appendProgress(id, event)`, `clearProgress(id)`, `recordPermissionRequest(id, req)`, `clearPermissionRequest(id)`.
- Subscription API mirrors `ChatMessageStore` (`subscribe`, `getSnapshot`) plus per-id selectors (`subscribeToolUse(id, cb)`) for fine-grained re-renders.
- Wiring: `AgentRunner.drive` calls `markRunning` on tool dispatch and `markResolved` / `markRejected` / `markCanceled` on the corresponding result/decision events. Cancellation path also bulk-cancels every still-in-progress id.
- Pure `statusOf(state, id, toolUseBlock?)` resolves precedence (rejected > canceled > errored > resolved > running > queued).
- Reset behaviour: `disposeThread(threadId)` clears every map / set for that thread. `plugin.onunload` disposes all.

Out of scope:
- Renderers — F04+.
- Persistence — F13 only persists tool-use blocks; run state itself is in-memory ([livestatus §12](../../../../srs/livestatus.md)).
- Permission decision controller — refactor of existing `confirmationController` happens in F06.

## Acceptance criteria

1. `RunStateStore` exposes typed mutators and a `getSnapshot(): Readonly<RunState>` returning frozen sets/maps. (FR-04)
2. `statusOf(state, id)` returns one of `'queued' | 'running' | 'success' | 'errored' | 'rejected' | 'canceled'` with the precedence above. Pure function, no IO. (FR-05)
3. `subscribeToolUse(id, cb)` fires only when the *specific* tool-use's status, progress, or permission-request changes — not on unrelated mutations. Verified by Vitest. (NFR-03)
4. `AgentRunner` is wired to call mutators on every relevant transition; `agentRunner.test.ts` covers happy path + cancellation + denial. (FR-04)
5. `streamingController.stop()` (or its callsite in F11) calls `markCanceled` for every id in `inProgressToolUseIds` before aborting the stream. (NFR-11)
6. Module is dependency-free of platform APIs — pure data + listener pattern; lives in domain/core layer per [`architecture.md` §3.3](../../../../architecture/architecture.md#33-domain--core-pure). (NFR-09)
7. Vitest unit suite at `tests/unit/chat/runStateStore.test.ts` covers: state transitions, selector precedence, subscription scoping, dispose.

## Dependencies

- Upstream: [F01](../F01-message-blocks/feature.md) — uses block ids only.
- Downstream: F04, F05, F06, F08, F09, F11.
- Touches: new `src/chat/runStateStore.ts`, [`src/agent/agentRunner.ts`](../../../../../src/agent/agentRunner.ts), [`src/agent/graph.ts`](../../../../../src/agent/graph.ts).

## Implementation notes

- State machine and selector behaviour: see [`livestatus.md` §4](../../../../srs/livestatus.md) (state diagram, mutator list, `statusOf` precedence).
- Pure-core / IO-at-edges architectural rule: see [`architecture.md` §1](../../../../architecture/architecture.md#1-architectural-principles) — store is pure, callers do IO.
- One in-flight request invariant + cancellation discipline: see [`architecture.md` §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules).
- TypeScript shapes: `Set` / `Map` typed by `string`, no enum, `as const` literal unions per [`code-style.md` § TypeScript](../../../../standards/code-style.md#typescript).

## Open questions

- Should the store be a true pure functional reducer (`runStateReducer(state, action) → state`) or an OO class with internal mutation? Default plan: class wrapping immutable snapshots — matches the existing `ChatMessageStore` style and integrates cleanly with `useSyncExternalStore`. Re-evaluate if reducer testing burden grows.
- Whether to namespace state per thread (one store with `Map<threadId, RunState>`) or instantiate one store per thread. Default: per-thread instance owned by `AgentRunner` thread context, like `historyByThread`.
