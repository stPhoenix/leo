# F03 · reveal-in-canvas-tool — `reveal_in_canvas` tool

## Purpose

Register the read-only `reveal_in_canvas({ path, nodeIds?, bbox? })` tool that opens a `.canvas` file and pan/zooms either to a supplied bbox or to the union bbox of `nodeIds`. Allowed in plan mode. Returns `{ ok: true, path, viewportApplied, warning? }` and falls through to plain open on Obsidian-version mismatch.

Covers [FR-CANVAS-04](../../context.md#functional-requirements), [FR-CANVAS-56](../../context.md#functional-requirements), [FR-CANVAS-58](../../context.md#functional-requirements).

## Scope

**In scope**

- Tool registration at `src/agent/canvas/tools/revealInCanvas.ts` via existing `ToolRegistry` (`requiresConfirmation: false`, `isReadOnly: true`, plan-mode allowlist entry).
- Zod input schema `{ path: string, nodeIds?: string[], bbox?: { x: number; y: number; w: number; h: number } }` with `.describe()` for LLM guidance.
- Bbox computation from `nodeIds` against parsed canvas JSON (union of node rects + `bboxPadding = 80`).
- `bbox` precedence: `bbox > nodeIds > default` (per SRS §3.13).
- Result shape `RevealResult` per SRS §8.4.

**Out of scope**

- Selection-state highlighting — open question.
- Internal-API surface — owned by F02.

## Acceptance criteria

1. Tool returns `ok: true, viewportApplied: true` when navigator succeeds — traces to FR-CANVAS-58.
2. Tool returns `ok: true, viewportApplied: false, warning: 'reveal_unsupported_in_this_obsidian_version'` when navigator falls back — traces to FR-CANVAS-57 / FR-CANVAS-58.
3. `nodeIds` translates to padded union bbox; non-existent ids in the list are skipped without error (logged at `debug`); empty resulting bbox falls back to default zoom — traces to FR-CANVAS-56.
4. `bbox` takes precedence over `nodeIds` when both supplied (deterministic, documented in `.describe()`).
5. Tool is allowed in plan mode (registry plan-mode allowlist updated; verified by plan-mode controller test) — traces to FR-CANVAS-04, FR-CANVAS-58.
6. `requiresConfirmation: false` and `isReadOnly: true` — verified in tool-registry test — traces to FR-CANVAS-04.

## Dependencies

- [../canvas-json/feature.md](../canvas-json/feature.md) — parses the `.canvas` file to read node rects.
- [../canvas-navigator/feature.md](../canvas-navigator/feature.md) — performs the actual open + pan/zoom.
- Requirements traced: [../../context.md#functional-requirements](../../context.md#functional-requirements) FR-CANVAS-04, FR-CANVAS-56, FR-CANVAS-58.

## Implementation notes

- [../../../../architecture/architecture.md#3-modules](../../../../architecture/architecture.md#3-modules) — Tools live under `src/agent/.../tools/` and follow `ToolResult` shape from §4.
- [../../../../architecture/architecture.md#4-key-contracts](../../../../architecture/architecture.md#4-key-contracts) — `ToolResult` typed `Ok | Err`; never throw past tool boundary.
- [../../../../standards/code-style.md#zod--tool-schemas](../../../../standards/code-style.md#zod--tool-schemas) — Zod `.describe()` is the LLM-facing surface.
- [../../../../standards/code-style.md#langgraph--agent-layer](../../../../standards/code-style.md#langgraph--agent-layer) — `requiresConfirmation` must be set explicitly; tool-result shape `{ ok, ... }` is mandatory.

## Open questions

- Should `nodeIds` containing only ids that don't exist in the canvas error or warn? Warn (return `ok: true, viewportApplied: false`) — defer to user UX feedback in Phase 1 smoke.
