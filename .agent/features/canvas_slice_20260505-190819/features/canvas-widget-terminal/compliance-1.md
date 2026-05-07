# Compliance iteration 1 — F18 canvas-widget-terminal

## Standards

- **tech-stack.md** — Zod schema with `schemaVersion: literal(1)` for forward-compat versioning; tree-shake friendly imports.
- **code-style.md** — `import type` for type-only; `as const` literal kind; no `any`; named exports; Zod parse at rehydration boundary; one Zod schema per concern; `safeParse` returns null instead of throwing on schemaVersion mismatch.
- **best-practices.md** — KISS (snapshot is plain JSON, no embedded thumbnails per open-question NFR-CANVAS-04); SRP (snapshot module / block module separation); Fail-Fast (parse boundary); Make-It-Observable (data-outcome / data-op attributes).
- **project-structure.md** — terminal snapshot under `src/agent/canvas/widget/`, terminal block under `src/ui/chat/blocks/`; tests under `tests/unit/canvas/`; stories colocated next to component.

## Verdict: PASS
