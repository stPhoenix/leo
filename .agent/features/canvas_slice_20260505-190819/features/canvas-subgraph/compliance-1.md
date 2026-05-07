# Compliance iteration 1 — F16 canvas-subgraph

## Standards

- **tech-stack.md** — TypeScript strict, named exports, no enums; hand-rolled FSM justified per Framework First exception (b: no LangGraph primitive matches single-thread linear FSM with adapter-driven `PREVIEWING` decision); subscribers/timers cleaned up.
- **code-style.md** — `import type` for all type-only imports; `as const` literal unions for phases/op-kind; no `any`; `Result<T>`-style discriminated unions for errors; `try/finally` releases mutex; no `console.log`; no comments narrating obvious code.
- **best-practices.md** — KISS (linear async/await > LangGraph for this shape); SRP (state.ts / subgraph.ts split); Fail-Fast (mutex+target checks upfront); Observable (CANVAS_LOG namespace logs at phase boundaries).
- **project-structure.md** — files under `src/agent/canvas/` per slice convention; test mirror at `tests/unit/canvas/subgraph.test.ts`.

## Verdict: PASS
