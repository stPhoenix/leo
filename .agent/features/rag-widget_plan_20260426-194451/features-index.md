# Features index

| # | id | slug | name | purpose | deps | ui-needed | priority | covers |
|---|----|------|------|---------|------|-----------|----------|--------|
| 1 | F01 | rag-snapshot | RAG snapshot collector | Pure adapter that produces a `RagSnapshot` payload by reading `VectorStore`, the latest `VaultIndexer` drain state, `GraphCache`, `ExcludeListStore`, and the resolved embedding model. Abortable, no UI. | — | no | high | FR-03, FR-04, FR-06, FR-07, NFR-01, NFR-02, NFR-03, NFR-08 |
| 2 | F02 | rag-widget | `rag` widget component + Storybook | React component registered as `registerWidget('rag', RagWidget)`; renders the snapshot read-only with idle / indexing / unavailable / empty / large-vault states. Includes `RagWidget.stories.tsx` covering each state. | F01 | yes | high | FR-02, FR-05, FR-09, NFR-04, NFR-05, NFR-06 |
| 3 | F03 | rag-slash-command | `/rag` slash command + wiring | Register the `/rag` slash command (and matching palette entry) in `ChatView`; on invocation runs the F01 collector behind an `AbortController`-aware handle and appends a widget message of kind `rag` with the F01 payload. Plumbs the new dependencies from `main.ts` through `ChatView` deps. | F01, F02 | yes | high | FR-01, FR-08, FR-10, NFR-07, NFR-08 |
