# F13 — Persistence & replay of typed blocks

## Purpose

Persist new typed-block messages, migrate legacy string-content records on load, and on resume mark every unresolved tool-use as `canceled`. Run-state itself stays in-memory; the persisted blocks plus a synthetic canceled marker keep `statusOf()` valid post-load. Covers [FR-18](../../context.md#functional-requirements), [FR-19](../../context.md#non-functional-requirements), [NFR-08](../../context.md#non-functional-requirements). No UI surface.

## Scope

In scope:
- `ConversationStore` schema bump: `messages[].content` becomes `ContentBlock[]` for assistant rows; user/banner/widget rows keep `content: string`.
- IndexedDB migration in `upgrade()` callback per [`code-style.md` § IndexedDB](../../../../standards/code-style.md#indexeddb-idb): legacy assistant rows get `[{type:'text', text}]`.
- Decision persistence: tool-use blocks include optional `decision: 'allow-once'|'allow-thread'|'deny'` (from F06). Tool-result blocks include `is_error` flag.
- Replay logic in `ConversationStore.load`:
  - For every `tool_use` block without a matching `tool_result` block in the same or subsequent message → emit a synthetic `tool_result {is_error:true, content:'(canceled)'}` user-message block, and mark the tool-use's status `canceled` for `statusOf` resolution.
  - Progress events not persisted.
  - Run-state store starts empty; canceled markers carry the status for renderers.
- `block.decision='deny'` keeps `statusOf` returning `rejected` even with no result block (the SRS makes the tool-result the carrier, but Leo's denial path produces a tool-result already; supports both).

Out of scope:
- Conversation thread index changes — already exists.
- Plan store, todo store — separate persistence layers.

## Acceptance criteria

1. Schema bump versioned in IndexedDB; migration runs once per user vault. (FR-18)
2. Legacy assistant rows load as single-text-block content; round-trip preserves payload. (FR-18)
3. Synthetic canceled marker emitted for every dangling tool-use; covered by Vitest using `fake-indexeddb`. (FR-19)
4. `statusOf` returns `canceled` for those tool-uses without consulting a runtime run-state store. (FR-19)
5. Persistence path is debounced (existing pattern); never holds an IndexedDB tx across an `await` of unrelated work. (per [`code-style.md` § IndexedDB](../../../../standards/code-style.md#indexeddb-idb))
6. Logger emits `info` on migration + count. (NFR-10 transitive)
7. Vitest unit suite at `tests/unit/storage/conversationStoreMigration.test.ts` covers: legacy load, synthetic cancel emission, denial replay, progress-events absence.

## Dependencies

- Upstream: [F01](../F01-message-blocks/feature.md), [F03](../F03-run-state-store/feature.md), [F06](../F06-inline-permission-prompt/feature.md) (decision field).
- Touches: [`src/storage/conversationStore.ts`](../../../../../src/storage/conversationStore.ts), [`src/storage/conversationSchema.ts`](../../../../../src/storage/conversationSchema.ts).
- Downstream: none.

## Implementation notes

- Persistence rules (do not persist progress, mark unresolved as canceled on resume): see [`livestatus.md` §12](../../../../srs/livestatus.md).
- Schema migration discipline: see [`code-style.md` § IndexedDB](../../../../standards/code-style.md#indexeddb-idb).
- Conversation store ownership and persistence path: see [`architecture.md` §6](../../../../architecture/architecture.md#6-state-ownership) and [`architecture.md` §3.2](../../../../architecture/architecture.md#32-agent-layer).
- Test patterns: see [`tech-stack.md` § Testing](../../../../standards/tech-stack.md#testing) and [`code-style.md` § Testing](../../../../standards/code-style.md#testing-vitest--msw).

## Open questions

- Whether to keep the legacy `content: string` field around (denormalised) for fast list rendering (e.g. ThreadSwitcher peek). Default: yes — emit a `summary: string` field at write time, computed via `toLegacyContent` (F01).
- Whether older threads beyond a certain age skip migration (lazy-only) or eager-migrate at startup. Default: lazy. Tracked as [OQ-01](../../context.md#open-questions).
