# Compliance iteration 1 — F06 delegate-external-tool

## Acceptance criteria

- AC1: PASS — `main.ts:556-561` registers `createDelegateExternalTool(...)` with the global `ToolRegistry`. Existing `ToolRegistry.listFor(thread)` includes the tool unless filtered by skill allowlists.
- AC2: PASS — `delegateExternal.ts:51-67` (DELEGATE_EXTERNAL_DESCRIPTION) instructs use only when no other tool fits AND task plausibly needs an external system, lists examples (web research, deep research, third-party CLI/HTTP), and notes that every escalation re-prompts.
- AC3: PASS — `delegateExternal.ts:97-101` supplies `actionLabels: { allow: 'Prepare external agent request', deny: 'Deny' }`. Tested in "confirmation request carries actionLabels and disableAllowForThread:true".
- AC4: PASS — Same site sets `disableAllowForThread: true`. Confirmation controller carries the flag for UI consumption.
- AC5: PASS — `delegateExternal.ts:104-115` returns the structured deny payload `{ok:false, error:{code:'denied'}, folder:null, files:[]}`. No subgraph started (orchestrator only invoked on the allow branch). Tested in "deny path returns structured payload with denied semantics".
- AC6: PASS — `orchestrator.ts:53-58` short-circuits with `{ok:false, busy:true, activeRunId}` when slot busy; tool turns this into `{ok:false, error:{code:'busy'...}}`. Tested in "prepare with active slot returns busy".
- AC7: PASS — `delegateExternal.ts:138-142` returns the `start.terminal` payload verbatim (no field remapping). `buildToolResult` from F05 is the sole producer.
- AC8: PASS — `DelegateExternalSchema` rejects empty / >16 KB asks; `validate()` returns `{ok:false, error:'<path>: <message>'}`. Tested in "schema rejects empty ask" + "schema rejects ask above 16 KB".

## Scope coverage

- In scope `src/tools/builtin/delegateExternal.ts`: PASS.
- In scope `Custom confirmation surface (Prepare/Deny labels)`: PASS via `actionLabels`.
- In scope `Tool invocation flow (deny / busy / prepare→suspended/terminal)`: PASS — `invoke` handler covers all three paths.
- In scope `Registration into ToolRegistry at plugin load`: PASS — `main.ts:556-561`.
- In scope `Integration tests using a stub subgraph`: PASS — `delegateExternalTool.test.ts` uses `ScriptedAdapter` + stub refine/writer to cover deny / busy / prepare→DONE / cancel paths.

## Out-of-scope audit

- Out of scope `Widget render and its actions (F08)`: CLEAN — F06 only emits `onHandle` for F07/F08 to consume.
- Out of scope `Subgraph internals (F03/F04/F05)`: CLEAN — orchestrator composes them via DI.
- Out of scope `Settings UI (F11)`: CLEAN.

## QA aggregate

PASS (typecheck + lint + tests + build all green; +8 tests). Integration gate: `delegate_external` tool registered in `ToolRegistry` at `src/main.ts:556`; `ExternalAgentOrchestrator` instantiated at `src/main.ts:537-554`. Both reachable from entry point.

## Verdict: PASS
