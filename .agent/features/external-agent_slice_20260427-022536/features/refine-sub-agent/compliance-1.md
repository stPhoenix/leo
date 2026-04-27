# Compliance iteration 1 — F04 refine-sub-agent

## Acceptance criteria

- AC1: PASS — `refineSubAgent.ts:104-110` rejects any non-allowed tool call by throwing `refine_invalid_tool`. Tested in "throws refine_invalid_tool when provider calls a non-allowed tool".
- AC2: PASS — `clarify` decision returned with `text` (the question); F03 driver wires the actual `awaiting_clarify` interrupt + `resumeClarify` answer round-trip (covered by `subgraph.test.ts:clarifying-question round-trip`).
- AC3: PASS — Budget enforcement lives in F03's `runRefineLoop` (`subgraph.ts:189-194`); when `refineIterations >= refineBudget`, transitions to `READY` with `refinedPrompt ?? originalAsk`. F04 contributes the per-iteration decision input.
- AC4: PASS — `refinePrompt.ts:8` exports `getRefineSystemPrompt()` (pure, no I/O / no time / no random). Tested via "is pure (same output across calls)".
- AC5: PASS — `RefineProvider` is `ProviderManager`-shape; `createRefineSubAgent` accepts the provider via DI. No per-adapter override surfaced.
- AC6: PASS — Free-form `token` deltas accumulated into `textBuffer` and emitted as `assistantMessage` on the decision (`refineSubAgent.ts:96-98`); F03 driver appends to `refineHistory`. Tested in "preserves assistant text in assistantMessage for history".

## Scope coverage

- In scope `src/agent/externalAgent/refinePrompt.ts`: PASS.
- In scope `Two stub tools wired into the refine sub-agent only`: PASS — `REFINE_TOOLS` is a private const passed in `ProviderChatRequest.tools`; not registered globally.
- In scope `Refine loop driver in subgraph.ts prepare node`: PASS — F03 driver invokes injected `RefineDeps.refine`, F04 supplies the implementation.
- In scope `Budget enforcement`: covered by F03 driver per AC3 above.
- In scope `interrupt() integration`: covered by F03 + F04 contract (clarify decision → `awaiting_clarify` phase + `resumeClarify`).
- In scope `Vitest suite`: PASS — `refinePrompt.test.ts` (4) + `refineSubAgent.test.ts` (8) + budget/clarify covered indirectly by `subgraph.test.ts`.

## Out-of-scope audit

- Out of scope `Widget rendering of clarifying question (F08)`: CLEAN — F04 only emits text payload.
- Out of scope `Provider configuration`: CLEAN — uses existing `ProviderManager`.
- Out of scope `Edit-from-READY → PREPARING re-entry`: CLEAN — F03 driver owns the re-entry; F04 just runs another turn.

## QA aggregate

PASS (typecheck + lint + tests + build all green; +12 tests). Integration gate: `createRefineSubAgent` is consumed by F05 (run-phase wiring) and F06 (delegate_external tool); not yet referenced from `src/main.ts`. F03 driver is reachable via `SlotManager` instance + the subgraph driver itself remains library-style.

## Integration notes

- `createRefineSubAgent` consumer wiring lands in F05 (subgraph orchestrator) which reads `providerManager` + `model` from `LeoPlugin`. No standalone wiring is required at F04 scope.

## Verdict: PASS
