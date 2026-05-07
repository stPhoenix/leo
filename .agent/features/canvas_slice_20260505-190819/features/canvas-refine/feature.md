# F08 · canvas-refine — Refine sub-agent + RunPlan schema

## Purpose

Hand-rolled refine sub-agent that parses the user's `ask` (and optional content-edit `instruction` + tombstone summary) into a Zod-validated `RunPlan` (`entityTypes`, `relationTypes`, `sourceHints`, `layoutHint`, optional `scope`, `outputPath`). Allowed actions: `ask_clarifying_question` / `emit_run_plan`. No vault tools. Up to `refineClarifyMax = 3` clarifying turns. Mirrors `src/agent/wiki/ingest/refine.ts` and `src/agent/externalAgent/refineSubAgent.ts`.

Covers [FR-CANVAS-06](../../context.md#functional-requirements), [FR-CANVAS-07](../../context.md#functional-requirements), [FR-CANVAS-08](../../context.md#functional-requirements), [FR-CANVAS-09](../../context.md#functional-requirements), [FR-CANVAS-10](../../context.md#functional-requirements).

## Scope

**In scope**

- `src/agent/canvas/refine.ts` exporting `createCanvasRefine({ provider, model, budgets, beginTrace? }) → CanvasRefine` with `step({ history, ask, tombstoneSummary?, signal }) → { kind: 'plan'; plan: RunPlan } | { kind: 'question'; question: string } | { kind: 'error'; code: string }`.
- `src/agent/canvas/refinePrompt.ts` exporting `getCanvasRefineSystemPrompt(): string` (snapshot, lint-tested for byte stability).
- Zod schemas: `EntityTypeDef`, `RelationTypeDef`, `SourceHint` (discriminated union per SRS §8.3), `RunPlan`. Validation rejects freeform `layoutHint` strings.
- Single retry on `RunPlan` Zod parse failure with parser-error injected into history (per FR-CANVAS-08).
- Iteration counter capped at `refineClarifyMax`; exhausting → `{ kind: 'error', code: 'refine_unresolved' }`.
- Optional `traceConfig` plumbed for Langfuse export (mirrors wiki).

**Out of scope**

- Driver-level "loop until plan or cap" — F16 owns the loop.
- Widget-side clarification UX — F17.
- Tombstone construction — F14.

## Acceptance criteria

1. `step` returns `{ kind: 'plan' }` when LLM emits a valid `emit_run_plan` tool call — traces to FR-CANVAS-06.
2. `step` returns `{ kind: 'question' }` when LLM emits `ask_clarifying_question`; question text is the LLM's argument verbatim — traces to FR-CANVAS-07.
3. Zod parse failure on `RunPlan` triggers exactly one retry with the parser-issue array injected as a `tool` message; second failure returns `{ kind: 'error', code: 'refine_invalid_plan' }` — traces to FR-CANVAS-08.
4. `layoutHint` outside the literal union (`'cluster'`, `'mermaid'`, etc.) rejects at Zod parse — traces to FR-CANVAS-09.
5. `outputPath` is required and is kebab-cased; if not present, parse fails — traces to FR-CANVAS-10.
6. Sub-agent has zero registered vault tools; only `ask_clarifying_question` and `emit_run_plan` are in its `tool_choice` set — traces to FR-CANVAS-06.
7. Tombstone summary (when supplied for content-edit) is concatenated into system context with the SRS-mandated wording — traces to FR-CANVAS-26.

## Dependencies

- [../canvas-budgets-runid-slug/feature.md](../canvas-budgets-runid-slug/feature.md) — `refineInputCap`, `refineOutputCap`, `refineClarifyMax`.
- Forward consumers: [../canvas-subgraph/feature.md](../canvas-subgraph/feature.md), [../canvas-diff/feature.md](../canvas-diff/feature.md) (passes tombstone summary), [../delegate-canvas-create/feature.md](../delegate-canvas-create/feature.md), [../delegate-canvas-content-edit/feature.md](../delegate-canvas-content-edit/feature.md).
- Requirements traced: [../../context.md#functional-requirements](../../context.md#functional-requirements) FR-CANVAS-06..10, FR-CANVAS-26 (tombstone routing).

## Implementation notes

- [../../../../architecture/architecture.md#4-key-contracts](../../../../architecture/architecture.md#4-key-contracts) — `Provider`, `ProviderChatRequest`, `traceConfig` plumbing.
- [../../../../architecture/architecture.md#5-data-flows](../../../../architecture/architecture.md#5-data-flows) — sub-agent → graph state plumb pattern (mirror of wiki ingest refine).
- [../../../../standards/code-style.md#langgraph--agent-layer](../../../../standards/code-style.md#langgraph--agent-layer) — typed tool results, no thrown errors past sub-agent boundary.
- [../../../../standards/code-style.md#zod--tool-schemas](../../../../standards/code-style.md#zod--tool-schemas) — `.describe()` on every `RunPlan` field; LLM-facing.
- [../../../../standards/best-practices.md#core-principles](../../../../standards/best-practices.md#core-principles) — Framework First: reuse existing refine pattern.

## Open questions

- For Qwen3 30B specifically, can we omit `tool_choice` enforcement and rely on prompt? Bench at Phase 6; default to enforced `tool_choice`.
- Should `outputPath` be auto-generated when `delegate_canvas_create.targetPath` already supplied? Yes — refine respects `targetPath` as authoritative (FR-CANVAS-10) and copies into `RunPlan.outputPath`.
