# F06 — Live widget + terminal snapshot framework

## Purpose

Single, phase-dispatched widget framework reused by both ingest (F11) and lint (F18) subgraphs: live block driven by an in-memory controller, persisted terminal block re-rendered on thread reopen, reload-rehydrate to `error.code='reload'`. Covers [context.md `Widget Lifecycle`](../../context.md#widget-lifecycle) FR-48..FR-51 and [NFR-02](../../context.md#non-functional-requirements).

## Scope

- In:
  - `WikiWidgetController` exposing `viewModel()` per phase + action handlers (clarify answer, cancel, duplicate-resolve, lint accept/reject, schema-patch confirm).
  - `WikiLiveBlock.tsx` registered under `WIKI_LIVE_KIND`, looks up controller via `liveControllerRegistry`.
  - `WikiTerminalBlock.tsx` registered under `WIKI_TERMINAL_KIND`, renders persisted `WikiTerminalSnapshot`.
  - `WikiTerminalSnapshot` Zod schema with `schemaVersion:1`; sensitive-field filtering before persistence.
  - Reload rehydration: any non-terminal snapshot at reload becomes `error.code='reload'` (NFR-02).
  - Storybook stories covering every phase view-model variant.
- Out: ingest/lint subgraph state production (F11/F18); slash commands; tool wiring.

## Acceptance criteria

1. `WikiLiveBlock` looks up the live controller via `liveControllerRegistry.get(runId)` and renders the phase-dispatched view (FR-48, FR-49).
2. View-model surfaces every ingest phase listed in FR-49 (refining transcript, fetch progress, persisting + duplicate prompt, plan summary, extractor progress, reducer progress, writer progress) and every lint phase (scanning/checking/proposing/awaiting_confirm/writing).
3. On terminal state, controller emits a Zod-valid `WikiTerminalSnapshot`; the block kind switches to `WIKI_TERMINAL_KIND`; the registry releases the live controller (FR-50).
4. Persisted snapshot re-renders into a collapsed one-line summary that expands to per-phase counts, per-source statuses, error message (if any), and the `log.md` line (FR-50).
5. Live block active at plugin reload rehydrates to `error.code='reload'` (FR-51, NFR-02).
6. `WikiTerminalSnapshot` Zod round-trip is stable; sensitive fields scrubbed.
7. Storybook covers the full state machine (idle, every per-phase variant, awaiting_clarify, awaiting_duplicate, cancelled, error-reload, error-other, done collapsed/expanded).

## Dependencies

- F04 (runId generator + live controller registry).
- Anchors: [context.md `Widget Lifecycle`](../../context.md#widget-lifecycle), [context.md `Non-functional requirements`](../../context.md#non-functional-requirements).

## Implementation notes

- Live + terminal blocks live in the UI layer; the controller in the agent layer — UI imports controller, no back-edge per [architecture.md §1](../../../../architecture/architecture.md#1-architectural-principles).
- Mirrors `src/agent/externalAgent/widgetController.ts`, `terminalSnapshot.ts`, `ExternalAgentLiveBlock.tsx`, `ExternalAgentTerminalBlock.tsx` per [project-structure.md](../../../../standards/project-structure.md).
- `WikiTerminalSnapshot` persists as a chat block payload owned by `ConversationStore` per [architecture.md §6](../../../../architecture/architecture.md#6-state-ownership); the `liveControllerRegistry` itself is in-memory only and discarded on plugin unload per [architecture.md §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules).
- React 18 function components + `useSyncExternalStore` per [code-style.md `React 18`](../../../../standards/code-style.md). Mount in `ItemView.onOpen`, unmount in `onClose`, per [architecture.md §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views).
- Zod schemas at boundary; `schemaVersion:1` versioning per [code-style.md `Zod & Tool Schemas`](../../../../standards/code-style.md).
- Tailwind utilities scoped under plugin root per [code-style.md `Styling (Tailwind + Obsidian)`](../../../../standards/code-style.md).
- Block kind registry hookup at `src/ui/chat/blocks/index.ts` per [project-structure.md](../../../../standards/project-structure.md).

## Open questions

- OQ-5 — diff-render `SCHEMA.md` patches in widget; recommend yes from day one if the diff renderer is cheap to reuse, per [context.md `Open questions`](../../context.md#open-questions).
