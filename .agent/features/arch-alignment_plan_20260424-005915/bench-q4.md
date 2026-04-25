# Q4 bundle bench — 2026-04-24

Gate from [decisions.md § Pre-impl action](decisions.md#pre-impl-action-gate-on-q4). Threshold: **40 KB gz delta** before escalation.

## Method

1. Prod build (`npm run build` → esbuild production) of current `master` @ 2ff3481.
2. `pnpm add zod zod-to-json-schema @langchain/langgraph`.
3. Added `src/__bundle_bench.ts` importing `StateGraph`, `START`, `END`, `interrupt` from `@langchain/langgraph`; `z` from `zod`; `zodToJsonSchema` from `zod-to-json-schema`. Referenced all three in a non-tree-shakeable probe function.
4. Wired a `void` reference from `LeoPlugin.onload` so esbuild could not drop the module.
5. Re-ran prod build.
6. Gzipped both bundles with `gzip -9`.
7. Reverted: removed `__bundle_bench.ts`, removed main.ts import + void call, ran `pnpm remove` on the three packages, rebuilt to confirm byte-identical baseline (447910 raw / 135596 gz — matches pre-bench).

## Measurement

| Build | `main.js` raw | `main.js.gz` | Δ gz vs baseline |
|---|---|---|---|
| Baseline (pre-install) | 447 910 B | 135 596 B | — |
| With zod + zod-to-json-schema + @langchain/langgraph wired | 1 480 537 B | 396 949 B | **+261 353 B (+192 %)** |
| Post-revert baseline | 447 910 B | 135 596 B | 0 B |

## Verdict

**FAIL the gate.** +261 KB gz is 6.5× the escalation threshold. Tripling the shipped bundle on an Obsidian plugin is unacceptable by [tech-stack.md](../../standards/tech-stack.md) size constraints (Obsidian plugin store guidance + NFR-PERF-05 streaming budget).

Root cause: `@langchain/langgraph` pulls `@langchain/core`, which carries msgpack, uuid, zod (v3), and a checkpoint abstraction layer. Tree-shaking recovers little because the `StateGraph` + `interrupt` surface touches most of core.

## Counter-proposal (per [decisions.md Q4 escalation](decisions.md#gate-questions))

Instead of bringing code to match architecture.md, **patch architecture.md to describe the current code** for the expensive items, and proceed with only the cheap code-side fixes:

### Keep as code changes (cheap, no bundle hit)
- **F02 — tool-ctx-adapters** (`ToolCtx.{vault, editor}`). Pure refactor, no new deps.
- **F03 — builtin-tool-layout** (move tool files into `src/tools/builtin/`). File moves, no new deps.
- **F06 — stream-event-union** (normalize `StreamEvent` to include `tool_confirmation` + `tool_result`). Pure types + internal normalization, no new deps.

### Flip to doc-side changes in architecture.md
- **F01 / §4 `ToolSpec`** — replace `schema: z.ZodType` with current `parameters: JsonSchema` + `validate: ToolValidate`. SRS behavior unchanged.
- **F04 / §1 "Interrupt-driven tool flow", §2 layer diagram, §3.2 GraphBuilder, §5.3, §9** — remove LangGraph references; describe the existing imperative `drive()` round-trip loop instead.
- **F05 / §1, §5.3** — replace `interrupt()` language with the existing `confirmTool` callback + `ConfirmationController` adapter.
- **F07 / §4 `AgentRunner` interface** — replace `AsyncIterable<StreamEvent>` return with the current `EventChannel` push API (or keep the `AsyncIterable` wording and add a thin adapter — still possible without langgraph).
- **F08 / package.json keywords** — drop the `"langgraph"` keyword (no langgraph in code).

### Net effect

- Bundle stays at 132 KB gz.
- Code cleanliness still advances via F02, F03, F06 (and optionally the AsyncIterable wrapper from F07 minus the graph).
- Architecture doc stops lying. Future contributors see what is actually there.

## What was not reverted

- `.agent/features/arch-alignment_plan_20260424-005915/` (this workspace, intentional artifact).
- `CLAUDE.md` (user-edited rule #5 unrelated to bench).

Everything else — `src/__bundle_bench.ts`, main.ts edits, `package.json` + `pnpm-lock`-state — fully reverted.
