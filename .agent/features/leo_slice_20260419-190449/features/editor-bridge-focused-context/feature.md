# F08 — Editor bridge & Focused Context

## Purpose

Wire Leo into the active CodeMirror 6 editor so the `AgentController` always knows what the user is looking at. A CM6 extension tracks cursor position, selection range, and visible viewport line range per [FR-EDIT-01](../../context.md#fr-edit-01); those values are bundled into a `FocusedContext` payload and pushed to `AgentController` on every editor update, debounced to ≤ 1/300ms per [FR-EDIT-02](../../context.md#fr-edit-02). Obsidian workspace listeners — `active-leaf-change`, `file-open` per [FR-EDIT-03](../../context.md#fr-edit-03) and `editor-change` per [FR-EDIT-04](../../context.md#fr-edit-04) — keep the bridge synchronized with tab switches, file opens, and user edits. The whole pipeline is held to the ≤ 5ms added-latency budget per [NFR-PERF-01](../../context.md#nfr-perf-01) so typing feel is never regressed.

## Scope

### In scope

- CM6 extension exposing a `StateField` that tracks cursor position, selection range, and visible viewport line range for the focused editor.
- `FocusedContext` payload assembly (file, cursor, selection, viewport) and emission to `AgentController` through an in-memory push channel.
- 300ms trailing debounce on `FocusedContext` emission, capped at ≤ 1 emission per 300ms (per [FR-EDIT-02](../../context.md#fr-edit-02)).
- Registration and teardown of Obsidian workspace listeners: `workspace.on('active-leaf-change')`, `workspace.on('file-open')`, `workspace.on('editor-change')` — all via `registerEvent` for auto-cleanup.
- Bridging active-leaf / file-open transitions into a fresh `FocusedContext` snapshot (null payload when there is no active markdown editor).
- Unit coverage for debounce timing, payload shape, and listener attach/detach symmetry.

### Out of scope

- Edit lock acquisition, readonly decorations, and `EditorTransaction` batching for programmatic edits — ship with F18 `editor-bridge-edit-lock-transactions`.
- Inline diff accept/reject UI and atomic revert — ship with F20 `editor-bridge-inline-diff-accept-reject`.
- Context indicator chip UI that renders the `FocusedContext` in the chat header — ship with F09 `chat-context-indicator`.
- Injecting `FocusedContext` into the LLM system prompt (owned by `AgentRunner` / `ContextAssembler`).
- Canvas / non-markdown editor support.

## Acceptance criteria

1. A CM6 extension is installed on the active markdown editor and, on every `EditorView.updateListener` tick, computes a `FocusedContext` containing non-null `cursor`, `selection` (empty when no range), and `viewport` (line range + text), matching the contract referenced by [FR-EDIT-01](../../context.md#fr-edit-01).
2. Bursts of editor updates emit at most one `FocusedContext` to `AgentController` per 300ms (trailing-edge debounce); the final update in a burst is always delivered per [FR-EDIT-02](../../context.md#fr-edit-02).
3. On `workspace.on('active-leaf-change')` and `workspace.on('file-open')` the bridge re-attaches its CM6 extension to the new editor and emits a fresh `FocusedContext` (or a null payload when the leaf has no markdown editor) per [FR-EDIT-03](../../context.md#fr-edit-03).
4. `workspace.on('editor-change')` triggers a `FocusedContext` refresh on the same debounce schedule and does not double-fire alongside the CM6 `updateListener` path per [FR-EDIT-04](../../context.md#fr-edit-04).
5. All three workspace listeners are registered via `registerEvent` in `onload` and are automatically torn down on `onunload`; no orphan listeners remain across plugin reload per [FR-EDIT-03](../../context.md#fr-edit-03) and [FR-EDIT-04](../../context.md#fr-edit-04).
6. Microbenchmark of the CM6 update path (compute + debounce scheduling, excluding downstream agent work) shows ≤ 5ms added latency per editor update at p95, satisfying [NFR-PERF-01](../../context.md#nfr-perf-01).
7. Unit tests cover: debounce rate limit (≤ 1/300ms with trailing delivery), payload field completeness (`file`, `cursor`, `selection`, `viewport`), and listener attach/detach symmetry across `active-leaf-change` / `file-open` / `editor-change` per [FR-EDIT-01](../../context.md#fr-edit-01), [FR-EDIT-02](../../context.md#fr-edit-02), [FR-EDIT-03](../../context.md#fr-edit-03), [FR-EDIT-04](../../context.md#fr-edit-04).

## Dependencies

- [F01 plugin-bootstrap-logging](../plugin-bootstrap-logging/feature.md) — `Plugin.onload` / `onunload` lifecycle and the `Logger` used for bridge events.
- Drives directly from [FR-EDIT-01](../../context.md#fr-edit-01), [FR-EDIT-02](../../context.md#fr-edit-02), [FR-EDIT-03](../../context.md#fr-edit-03), [FR-EDIT-04](../../context.md#fr-edit-04), [NFR-PERF-01](../../context.md#nfr-perf-01).

## Implementation notes

- [Architecture §3.4 Adapters — EditorBridge](../../../../architecture/architecture.md#34-adapters) — places the CM6 extension pattern (StateField for cursor/selection/viewport) in the adapter layer; this feature implements the tracking half.
- [Architecture §4 Key Contracts — FocusedContext](../../../../architecture/architecture.md#4-key-contracts) — pins the payload shape `{file, cursor, selection, viewport}` the bridge must emit.
- [Architecture §6 State Ownership](../../../../architecture/architecture.md#6-state-ownership) — `FocusedContext` is in-memory only; no disk persistence here.
- [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) — `plugin.onunload` must detach listeners; aligns with `registerEvent` teardown here.
- [Tech stack — Platform APIs](../../../../standards/tech-stack.md#platform-apis) — names `Editor` + CM6 (`@codemirror/state`, `@codemirror/view`) as the StateField host for cursor/selection/viewport.
- [Code style — CodeMirror 6](../../../../standards/code-style.md#codemirror-6) — extensions composed in `editor/extensions.ts`, state via `StateField`, `EditorView.updateListener` reads state without mutation.
- [Code style — Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) — `workspace.on(...)` listeners registered via `registerEvent` for auto-cleanup; no hand-rolled teardown.
- [Code style — Async & Concurrency](../../../../standards/code-style.md#async--concurrency) — use the shared `debounce` util for the 300ms gate; don't re-roll timing.
- [Best practices — Core Principles](../../../../standards/best-practices.md#core-principles) — observable checkpoints justify a structured `event: "editor.focus"` log entry on each emission at `debug` level.

## Open questions

- None. Acceptance criteria and implementation notes exhaust this feature's scope; no decisions are deferred at this slice.
