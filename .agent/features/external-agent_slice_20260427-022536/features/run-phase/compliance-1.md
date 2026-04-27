# Compliance iteration 1 — F05 run-phase

## Acceptance criteria

- AC1: PASS — `runPhase.ts:91-99` (`createPassthroughAdapterCallDeps`) forwards `{refinedAsk, systemPrompt, signal, timeoutMs, config}`. Subgraph `runAdapterPhase` (subgraph.ts:298-307) supplies them.
- AC2: PASS — `state.ts:applyExternalEvent` text branch concatenates onto `textBuffer`; F03 happy-path test asserts ordering.
- AC3: PASS — `state.ts:applyExternalEvent` file branch appends to `pendingFiles`. F02 ResultWriter consumes the list later (no immediate vault write inside the run node).
- AC4: PASS — `subgraph.ts:362-370` & `subgraph.ts:393-396` route `done` → WRITING and `error` → finishWithError(adapterError).
- AC5: PASS — `subgraph.ts:286-293` setTimeout sets `timedOut=true` + abort; `finishWithError('timeout', …)` runs.
- AC6: PASS — Cancel from running terminates within 2 s wall clock; F03 test "cancel from running → cancelled within tens of ms" already enforces ≤50 ms with a real-clock measurement.
- AC7: PASS — `subgraph.ts:309-360` always races `next()` against the abort signal + grace timer; `runPhase.test.ts:transitions to error abort_timeout when adapter does not honor abort` proves it.
- AC8: PASS — `runPhase.ts:38-48` builds `summary = textBuffer.slice(0, 500)`; `runPhase.test.ts:done → ok payload with summary cap` asserts `summary.length === 500`.
- AC9: PASS — `subgraph.ts:373-385` finally: clears timer, removes abort listener, calls `iterator.return()`; ResultWriter wrapping closes vault writes per F02's own try/finally.
- AC10: PASS — `buildToolResult` covers all three terminal payload variants verified by tests.

## Scope coverage

- In scope `run node implementation`: PASS — extended F03 driver.
- In scope `Event accumulation`: PASS — `applyExternalEvent` (F03) + driver routing.
- In scope `Timeout`: PASS — driver `timer`.
- In scope `Cancel handling`: PASS — driver `onCancel` + grace race.
- In scope `write node`: PASS — `createResultWriterDeps`.
- In scope `terminal node payload`: PASS — `buildToolResult`.
- In scope `Vitest suite`: PASS — `runPhase.test.ts` + F03 `subgraph.test.ts` together cover happy path, timeout, cancel mid-stream, adapter throws, adapter error event, writer fails.

## Out-of-scope audit

- Out of scope `Adapter implementations`: CLEAN — none added.
- Out of scope `Writer internals`: CLEAN — F02 unchanged.
- Out of scope `Widget event projection`: CLEAN — driver only mutates state; widget bridge is F07.

## QA aggregate

PASS (typecheck + lint + tests + build all green; +7 tests). Integration gate: `runPhase.ts` exports consumed by F06 (delegate_external tool) and F07/F08 (widget) in subsequent features. The driver itself is reachable via the `SlotManager` singleton in `main.ts`; the helper module is library-style, awaiting F06's `delegate_external` registration to wire it end-to-end into `src/main.ts`.

## Integration notes

- `runPhase.ts` (`buildToolResult`, `createResultWriterDeps`, `createPassthroughAdapterCallDeps`) are imported by F06 to compose the suspended-tool wiring; not yet referenced from `src/main.ts`. The wiring is owned by F06 per the feature DAG.

## Verdict: PASS
