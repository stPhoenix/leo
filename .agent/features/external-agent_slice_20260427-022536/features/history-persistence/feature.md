# F12 — History persistence + rehydration

## Purpose

Make terminal-state widgets durable: the collapsed summary, refine transcript, refined prompt, folder/file list, duration, and (on error) error block persist into `messageStore` so the widget remains visible — collapsed and read-only — when the thread is reopened later. Also handles the `reload` rehydration case for in-flight runs that were interrupted.

Implements [`context.md`](../../context.md) FR-EXT-26 (persistence portion) and the persisted-state half of NFR-EXT-04.

## Scope

**In scope**
- `src/chat/types.ts`: extend the chat block discriminated union with `external_agent_widget` block kind.
- Persisted payload shape (Zod schema in `src/chat/types.ts`):
  ```ts
  z.object({
    runId: z.string(),
    adapterId: z.string(),
    terminalPhase: z.enum(['done','cancelled','error']),
    folder: z.string().nullable(),
    files: z.array(z.string()),
    durationMs: z.number().int().nonnegative(),
    refinedPrompt: z.string(),
    refineTranscript: z.array(z.object({ role: z.enum(['assistant','user']), content: z.string() })),
    error: z.object({ code: z.string(), message: z.string() }).nullable(),
    adapterConfigSnapshot: z.record(z.unknown()),  // non-secret subset only
  })
  ```
- `src/chat/messageStore.ts`: handle persistence + rehydration of the new block kind. On thread save: serialize the latest controller state per terminal phase. On thread load: instantiate widget in collapsed terminal mode.
- `src/agent/externalAgent/widgetController.ts` (extends F07): on terminal transition, emit a `terminalSnapshot` event consumed by `messageStore` for persistence. On controller construction with a persisted snapshot (no live subgraph), initialize directly into collapsed terminal view.
- Reload-rehydration path: when a thread is reopened during an active subgraph (or after a plugin reload that killed the subgraph), the persisted block exists with `terminalPhase='error'` and `error.code='reload'` — added by an `onunload` flush in `main.ts`.
- Adapter-config snapshot filtering: traverse the resolved `config` and drop any field whose `configSchema` declares `.describe('secret')`. Honors OQ-08 from context.
- Vitest suite covering: round-trip serialize → deserialize preserves all fields, secret filter drops marked fields, reload-flush writes the right payload, malformed persisted block (older shape) is dropped with `warn` log instead of crashing.

**Out of scope**
- Conversation-store schema migration (no prior shape exists for this block kind; additive).
- Streaming-state persistence (only terminal snapshots persist; live `RUNNING` state is in-memory only per NFR-EXT-04).
- New UI — F08 already renders the collapsed view; F12 just keeps it alive across reopens.

## Acceptance criteria

1. New block kind `external_agent_widget` added to `chat/types.ts` discriminated union, with the Zod schema in §Scope. Existing thread JSONs without this kind load without error.
2. On terminal subgraph state, `widgetController` emits exactly one `terminalSnapshot` event; `messageStore` persists it as part of the next thread save (debounced per existing `messageStore` policy). Honors FR-EXT-26 (persistence portion).
3. Persisted snapshots round-trip: `serialize(snapshot) → JSON → deserialize` yields a structurally-equal object. Verified by Vitest snapshot test on a non-trivial fixture.
4. Reopening a thread that contains a persisted `external_agent_widget` block renders the F08 widget in collapsed terminal view immediately, *without* any subgraph being active. The widget's expand action shows the full refine transcript + final prompt + error block (if any).
5. Reload flush: `Plugin.onunload` writes a final snapshot for any non-terminal in-flight subgraph with `terminalPhase='error'` and `error={code:'reload', message:'Plugin reloaded during run'}`. Honors NFR-EXT-04.
6. Adapter-config snapshot filter:
   - Reads adapter's `configSchema` to enumerate `.describe('secret')` fields.
   - Drops them from the snapshot before persistence.
   - Test: a config with `apiKey: '<redacted>'` (marked secret) and `model: 'sonar-pro'` produces a snapshot containing `model` only. Honors OQ-08.
7. Malformed / older persisted block shape (e.g. missing `refineTranscript`) is dropped at load time with a `warn` log; thread loads successfully without that block. No throw.

## Dependencies

- **F07** — controller emits `terminalSnapshot`; controller initializes from persisted snapshot.
- **F08** — collapsed terminal rendering already exists; F12 just feeds it data on rehydrate.
- Cross-doc:
  - [`context.md#fr-ext-26`](../../context.md#functional-requirements)
  - [`context.md#nfr-ext-04`](../../context.md#non-functional-requirements)
  - [`../widget-controller/feature.md`](../widget-controller/feature.md)
  - [`../widget-ui/feature.md`](../widget-ui/feature.md)

## Implementation notes

- Existing block-union pattern — `src/chat/types.ts`; assistant blocks live in `src/ui/chat/blocks/AssistantBlocks.tsx` per [`.agent/standards/project-structure.md`](../../../../standards/project-structure.md).
- Persistence cadence — `messageStore`'s debounced save discipline; same module already handles attachments and other complex blocks; see [`.agent/architecture/architecture.md`](../../../../architecture/architecture.md) §3.2 (`ConversationStore`).
- Onunload flush — lifecycle pattern in [`.agent/architecture/architecture.md`](../../../../architecture/architecture.md) §10 ("Plugin unload").
- Forward-compat — additive Zod schema with `.catch()` semantics on optional fields per [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §"Zod & Tool Schemas".
- Secret filter — uses `configSchema` introspection only; no separate redaction list to keep in sync.

## Open questions

- **OQ-01-F12** Should the persisted snapshot include the full event log (potentially KB-scale) or only the response text? **Proposed**: response text + a "log was N events" counter. Full log retained in result folder if user needs forensics.
- **OQ-02-F12** When a snapshot was saved by an older plugin version with a different schema, should we attempt migration or always drop? **Proposed**: drop with `warn`; explicit migration introduces compat surface we don't want pre-1.0.
- **OQ-03-F12** Reload-flush ordering — does `Plugin.onunload` run before or after `messageStore` flush? Need to verify against existing `onunload` order in `src/main.ts`. **Proposed**: enqueue snapshot first, await `messageStore.flush()`, then proceed with rest of unload teardown. Document the required order.
