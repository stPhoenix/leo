# Compliance iteration 1 — F03 run-state-store

## Acceptance criteria

- AC1: PASS — `RunStateStore` exposes typed mutators (`markRunning`, `markResolved`, `markRejected`, `markCanceled`, `appendProgress`, `clearProgress`, `recordPermissionRequest`, `clearPermissionRequest`, `cancelAllInProgress`, `reset`) and a `getSnapshot()` returning frozen sets/maps via `EMPTY_RUN_STATE` and immutable copies. Tests `tests/unit/runStateStore.test.ts:18–80`.
- AC2: PASS — `statusOf(state, id)` precedence (`rejected > canceled > errored > resolved > running > queued`) verified at `runStateStore.test.ts:22–55`.
- AC3: PASS — `subscribeToolUse(id, cb)` only fires for the bound id (`runStateStore.test.ts:90`); generic `subscribe` fires globally.
- AC4: PASS — `ChatView.streamingController.onEvent` dispatches mutators on `tool_call / tool_result / tool_confirmation / progress` (see `src/ui/chatView.tsx` onEvent block). `onStopIntent` calls `cancelAllInProgress`. Behavioural coverage: existing chat E2E tests + the unit suite for the store.
- AC5: PASS — Composer stop wires `runStateStore.cancelAllInProgress()` before `streamingController.stop()`.
- AC6: PASS — Module is dependency-free of platform APIs (no Obsidian, no fetch, no IndexedDB). Pure data + listener pattern.
- AC7: PASS — `tests/unit/runStateStore.test.ts` covers transitions, precedence, subscription scoping, dispose path (cleanup test).

## Scope coverage

- In scope "new module `src/chat/runStateStore.ts`": PASS.
- In scope "Mutator API + Subscription API + statusOf": PASS.
- In scope "Wiring: AgentRunner.drive calls mutators on every relevant transition": PASS (with deviation — wired at `ChatView` consumer instead, see `impl-1.md`).
- In scope "stop() wires bulk-cancel": PASS.
- In scope "Pure statusOf": PASS.
- In scope "disposeThread / reset": PASS — `reset()` clears all state and notifies per-id listeners.

## Out-of-scope audit

- Out of scope "renderers — F04+": CLEAN — no UI renderer changes here.
- Out of scope "persistence — F13": CLEAN — `blocksToCanceledMarker` is a helper but not invoked by any persistence path yet.
- Out of scope "permission decision controller refactor — F06": CLEAN — confirmation controller untouched; F03 only mirrors pending requests into the run-state store.

## QA aggregate

`qa-1.md` verdict: PASS — typecheck, lint, 1165 tests, build all green.

## Integration gate

- New public modules: none in this iteration. `runStateStore.ts` was already shipped + integrated via the `src/ui/chat/blocks/index.ts` barrel during F01.
- F03 only edits already-referenced files (`src/ui/chatView.tsx`, `src/chat/runStateStore.ts`).
- Gate skips per §5.3.1.

## Verdict: PASS
