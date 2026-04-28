# Context — `/rag` widget

## Scope

Add user-visible visibility into the RAG / vault-index subsystem via:

- A new chat slash command `/rag` that emits an inline widget message into the active thread.
- A new widget kind (`rag`) registered in the widget registry, rendered by the chat message list, mirroring the existing `/context` → `ContextWidget` pattern.
- The widget surfaces RAG state: indexed-files count, total chunks (vector rows), embedding model + vector dimension, store availability/health, indexer drain progress (active/dirty/idle), exclude rules count, link-graph size, and approximate vector store storage size.
- A Storybook entry for the new widget covering the core states (idle / indexing / unavailable / empty).

## Out of scope

- Live tail / auto-refresh polling beyond an optional in-flight refresh while the widget is mounted (one snapshot at command time is enough; refresh while indexing is welcome but not required).
- Settings UI changes (no new toggles, model pickers, exclude editor, etc.).
- Reindex/rebuild controls inside the widget (the widget is read-only for v1).
- New telemetry / metrics export, structured log changes, or status-bar redesign.
- Mobile/non-desktop styling work.
- Persistence of the widget message across reload (it is appended to the current thread like `/context`).
- Changes to embedding pipeline, chunker, or scorer.

## Actors

- **End user** — types `/rag` in the chat composer; reads the rendered widget. Optionally clicks command palette entry that triggers the same flow.
- **Plugin host (`main.ts`)** — wires dependencies (vector store, vault indexer, graph cache, exclude store, embedding model resolver) into the chat view at startup so the slash command can pull a snapshot.
- **Vector store (`VectorStore`)** — read-only data source for chunk count, header (model, dim), availability flag.
- **Vault indexer (`VaultIndexer`)** — read-only data source for drain progress (latest `DrainEvent` state — active/dirty/remaining/last-error).
- **Graph cache (`GraphCache`)** — read-only data source for link-graph node count.
- **Storybook** — renders the widget in isolation against fixture snapshots for design/QA.

## Functional requirements

- **FR-01** — Register a new slash command `/rag` (no args, default-match) in the chat slash registry alongside `/context` and `/compact`. Invocation appends a widget message of role `widget` and kind `rag` to the active thread's message store.
- **FR-02** — Provide a `rag` widget component registered via `registerWidget('rag', RagWidget)` in `src/ui/chat/widgets/`. The component reads its payload and renders the read-only stats panel.
- **FR-03** — The widget payload must expose at minimum: `filesIndexed` (distinct vector-row paths), `chunkCount` (vector-row total), `model` (header.model or `null`), `dim` (header.dim or `null`), `storeAvailable` (boolean), `indexerStatus` (`{ phase: 'idle' | 'draining' | 'paused-on-user' | 'errored', remaining: number, lastError?: string, currentPath?: string }`), `excludePatternCount`, `graphNodeCount`, `approxBytes` (sum of `vector.length × 4` + text bytes, or `null` if unavailable).
- **FR-04** — Snapshot collection runs on command invocation behind an `AbortController`-aware async function (mirroring `createContextCommand`), so a re-issue of `/rag` while a prior collection is in flight cancels the prior one.
- **FR-05** — When the vector store is unavailable / corrupted (`!store.isAvailable()` or open failed), the widget renders a single "RAG unavailable — <reason>" line plus the indexer status (which may still be useful), instead of zeroed counts.
- **FR-06** — When the vault is fully indexed but contains zero indexable files, render the empty state (`filesIndexed = 0`, `chunkCount = 0`) without falling into the unavailable branch.
- **FR-07** — While indexing is active (`DrainEvent.kind === 'start' | 'tick'`), include remaining count and current path; allow the widget to optionally update if a new snapshot is published, but it is acceptable for v1 to render the snapshot taken at command time only.
- **FR-08** — Slash command entry must be visible in the slash picker (descriptive: "Show RAG / index status").
- **FR-09** — Provide a Storybook stories file (`RagWidget.stories.tsx`) covering: idle populated, indexing in progress, unavailable, empty vault, large vault (e.g. 10k chunks formatted with locale separators).
- **FR-10** — Dependency wiring (vector store + indexer drain subscription + graph cache + exclude store + embedding model resolver) must be plumbed from `main.ts` through `ChatView` deps without leaking platform types into the widget component.

## Non-functional requirements

- **NFR-01** — Snapshot collection must not block the UI. Reading `store.getAll()` to compute path/chunk counts may scan all rows; the implementation must run inside the same `Promise`-based, abortable wrapper as `/context` so the chat keeps streaming. Alternatively, derive `filesIndexed` from a cheaper IDB index if practical, but v1 is allowed to scan.
- **NFR-02** — No additional hot-path subscriptions on the indexer; reuse the existing `DrainListener` pattern from `IndexerStatusBar` to expose latest state via a thin `IndexerSnapshot` adapter, not a new bus.
- **NFR-03** — No PII or note text leaves the renderer. The widget only displays counts, model name, paths of currently-indexing files (already shown by the status bar — same constraint), and aggregated bytes.
- **NFR-04** — Bundle delta must stay within the existing budget (< 1.5 MB main.js); no new runtime deps. Storybook entry uses existing fixture infra (`__stories__/mocks`).
- **NFR-05** — The widget must be styled with Tailwind utilities scoped under `.leo-root`; if any new CSS variables/classes are added they must follow the `leo-rag-widget-*` naming convention (mirrors `leo-context-widget-*`).
- **NFR-06** — Component must be a pure function over its payload (no side effects, no `useEffect` subscriptions in v1) so Storybook can render every state from a static fixture.
- **NFR-07** — Slash command registration must guard against duplicate registration (registry already throws on re-register; ensure idempotent wiring at view re-open).
- **NFR-08** — Logging on snapshot path uses `Logger` at `info` level for invocation and `warn` for collection failures; `console.log` is forbidden by the project style guide.

## Constraints

- **C-01** — The widget mechanism is fixed: appending a `role: 'widget'` record with `widget: { kind, props }` and registering the component via `registerWidget`. New machinery is not allowed.
- **C-02** — Slash registry is shared with `/context`, `/compact`, `/clear`, etc.; collisions throw at registration. The new command name must be exactly `rag` (lowercase) and cannot conflict.
- **C-03** — Widget state must be derivable from already-existing modules: `VectorStore`, `VaultIndexer`/`DrainEvent`, `GraphCache`, `ExcludeListStore`, settings store (for `embeddingModel()` resolver). No new persistence.
- **C-04** — Tests must use Vitest with `happy-dom`; Storybook follows the existing `*.stories.tsx` pattern, including the obsidian-vars preview and shared mocks.
- **C-05** — TypeScript strict mode, no `any`, no default exports, named exports only — per `code-style.md`.
- **C-06** — UI layer must not import platform/IO modules directly; the widget receives a typed payload, not a `VectorStore` reference.

## Glossary

- **RAG (Retrieval-Augmented Generation)** — vector-store-backed retrieval pipeline that returns relevant note chunks for a query, implemented by `RAGEngine` over `VectorStore`.
- **Vector row** — a single chunk persisted in IndexedDB with `id`, `path`, `line_start/end`, `vector`, `text`, `tags` (see `VectorRow` in `vectorStore.ts`).
- **Index header** — singleton `{ model, dim, version }` record describing the embedding model that produced the current vectors (`IndexHeaderRow`).
- **Chunk** — a contiguous markdown/canvas slice produced by the chunker before embedding (`Chunk` in `chunker.ts`).
- **Drain event** — progress event emitted by `VaultIndexer` while it processes its dirty queue (`DrainEvent`: `start | tick | complete | error | dirty`).
- **Widget message** — chat message with `role: 'widget'` and a `widget: { kind, props }` payload, rendered by looking up `kind` in the widget registry.
- **Slash command** — text starting with `/` parsed by `parseSlashInput`; matches a registered `SlashCommand` and runs its `run(ctx)`.

## Open questions

- **OQ-01** — Should the widget refresh itself when the indexer fires a drain event after the message was appended, or is the snapshot at command time sufficient for v1? Default assumption (carried into the feature doc): one-shot snapshot, no live refresh; user can re-issue `/rag` to refresh.
- **OQ-02** — `approxBytes` accuracy: a precise number requires walking every vector row. Acceptable to display "≈" with a sample-based estimate (e.g. `chunkCount × dim × 4` for vectors plus average text byte length × `chunkCount`)? Default assumption: report two derived numbers — `vectorBytesApprox = chunkCount × dim × 4`, plus optional `textBytesApprox` from a sampled subset, both labelled as approximations. If too costly, omit `textBytesApprox` and only show vector bytes.
- **OQ-03** — Command-palette entry parity with `/context` (`leo-show-context`) — should `/rag` also register a palette command (`leo-show-rag`)? Default assumption: yes, mirror the pattern, but it's small enough to gate behind explicit user request if scope creeps.
- **OQ-04** — Where to surface "exclude patterns count": include effective patterns from `ExcludeListStore` only, or also flag if user has provider-side / model-pinned filters? Default assumption: only `ExcludeListStore.size()` (or equivalent) for v1.
