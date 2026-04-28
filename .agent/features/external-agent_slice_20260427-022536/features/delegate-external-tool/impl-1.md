# Impl iteration 1 — F06 delegate-external-tool

## Summary

Built `delegate_external` as a built-in tool spec (`requiresConfirmation: false`) that owns its own per-call confirmation prompt: `Prepare external agent request` / `Deny`, with the `ConfirmationController` extended to carry `actionLabels` + `disableAllowForThread`. Tool input schema rejects empty/whitespace asks and `>16 KB` payloads with structured Zod errors. On `deny` the tool returns the FR-EXT-03 payload `{ok:false, error:{code:'denied'...}, folder:null, files:[]}` wrapped as `{ok:true, data: …}` so the LLM observes the structured shape. On `prepare` the new `ExternalAgentOrchestrator` (per-thread `SlotManager.acquire` → busy short-circuit → start subgraph → forward terminal payload via `buildToolResult`). The widget controller (F07) plugs in via the `onHandle` deps callback to drive Send / Edit / Cancel / clarify-resume actions. Wired into `main.ts`: `ResultWriter`, `ExternalAgentOrchestrator` (with `createRefineSubAgent` + `createPassthroughAdapterCallDeps` + `createResultWriterDeps`), and `createDelegateExternalTool` registered into `ToolRegistry` at plugin load.

## Files touched

- `src/agent/confirmationController.ts` — additive `actionLabels`, `disableAllowForThread` on `ToolConfirmationRequest`; `ToolConfirmationActionLabels` type.
- `src/agent/externalAgent/orchestrator.ts` — `ExternalAgentOrchestrator` (slot-aware run starter; returns `{handle, terminal: Promise<DelegateExternalToolResult>}`).
- `src/tools/builtin/delegateExternal.ts` — tool spec + Zod schema + invoke flow.
- `src/agent/externalAgent/subgraph.ts` — added abort-race around `refine.refine` so cancel mid-PREPARING terminates the run promptly.
- `src/main.ts` — wired `ResultWriter`, `ExternalAgentOrchestrator`, registered `delegate_external` tool.
- `tests/unit/externalAgent/delegateExternalTool.test.ts` — 8 cases (schema rejection x2, deny path, prepare→DONE with simulated widget Send, busy slot, requiresConfirmation flag, confirmation request shape, ctx.signal cancellation).

## Tests added or updated

- AC1 — `main.ts` registers the tool; (registry-level visibility is asserted by existing `ToolRegistry` plumbing tests in F01/F02).
- AC2 — Description string (verified in source; not redundantly snapshot-tested to keep updates cheap).
- AC3 — `confirmation request carries actionLabels and disableAllowForThread:true` test.
- AC4 — Same test asserts `disableAllowForThread:true`.
- AC5 — `deny path returns structured payload with denied semantics`.
- AC6 — `prepare → DONE returns terminal payload`, `prepare with active slot returns busy`.
- AC7 — Tool returns `start.terminal` value verbatim (no remap).
- AC8 — `schema rejects empty ask`, `schema rejects ask above 16 KB`.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- `requiresConfirmation: false` on the spec: F06 calls `ConfirmationController.request` directly inside `invoke`, sidestepping the graph's deny-as-error short-circuit. This preserves the FR-EXT-03 `{ok:false, denied:true}` payload shape (the graph's existing tool-confirmation flow can only return `{ok:false, error:'string'}` on deny). The result is the same UX (one confirmation prompt, two buttons) with the structured payload preserved.
- The structured payload wraps inside `{ok:true, data: …}` at the `ToolResult` layer so the existing graph + serializer treat it as a successful tool call (the LLM-visible JSON is the FR-EXT-22/23/24 payload). Wrapper-`ok=false` would lose the structured fields to the graph's string-error path.

## Assumptions

- Per OQ-01-F06: `disableAllowForThread` and `actionLabels` extension to `ToolConfirmationRequest` is additive; defaults preserve other tools' UX.
- Per OQ-02/03-F06: tool description includes a short bulleted "use only when" list and a "user must approve every call" sentence to nudge the model away from speculative escalations.
- The widget (F07/F08) plugs into `onHandle` to drive Send / Edit / Cancel; without it the run hangs at READY (acceptable until F08 ships).

## Open questions

OQ-01/02/03-F06 honored. No new open questions.
