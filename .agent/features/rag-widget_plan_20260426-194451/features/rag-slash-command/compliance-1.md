# Compliance iteration 1 — F03 rag-slash-command

## Acceptance criteria

- AC1: PASS — Slash registration block in `src/ui/chatView.tsx:556–571` calls `createRagCommand({ collect, render, onError, logger })` and registers a `SlashCommand` with `name: 'rag'` whose `run` invokes `handle.invoke()`. The handle's `render` calls `renderRagAsWidget(snapshot)` (`src/ui/chatView.tsx:598–607`), which appends a `role: 'widget'` record with `widget: { kind: 'rag', props: { snapshot } }`. Unit test "renders the snapshot returned by collect" (`tests/unit/ragCommand.test.ts`) confirms render is called once with the snapshot.
- AC2: PASS — The slash command description is exactly `'Show RAG / index status'` (`src/ui/chatView.tsx:567`); `slashCommands.ts:list()` returns descriptions in the picker.
- AC3: PASS — Test "cancels prior in-flight invocation; only the second renders" asserts only the second `invoke()` call results in `render`; implementation `src/ui/ragCommand.ts:23` aborts the prior controller before issuing a new one.
- AC4: PASS — Test "reports collector errors via onError without rendering" asserts no render and one `onError` call. ChatView wires `onError: (err) => new Notice(\`RAG: \${err.message}\`)` (`src/ui/chatView.tsx:561`). No widget message is appended on error because `render` is the only path that appends.
- AC5: PASS — `buildSlashRegistry()` is called once per `onOpen()` in `src/ui/chatView.tsx:209`; on `onClose` the registry handle is nulled (`src/ui/chatView.tsx:380`). A subsequent `onOpen` builds a fresh registry, so no duplicate `register` call ever occurs in the same registry instance.
- AC6: PASS — Palette command registered in `src/main.ts:1013–1025` via `registerLeoCommand` using `RAG_PALETTE_COMMAND_ID` (`'leo-show-rag'`) and `RAG_PALETTE_COMMAND_NAME` (`'Leo: Show RAG status'`). The callback opens or focuses the chat view and calls `view.triggerRagSlash()` which invokes `this.ragCommand?.invoke()` (no-op when undefined). No throw on absent deps because `triggerRagSlash` uses optional chaining.
- AC7: PASS — `main.ts` builds the collector from existing `IndexerRagWiring` outputs (`this.indexerRag.vectorStore`, `this.indexerRag.graphCache`, `this.indexerRag.excludeStore`, `this.indexerRag.vaultIndexer.subscribe`) — no duplicate vector-store. `src/ui/ragCommand.ts` imports only `Logger` (type) and `RagSnapshot` (type); no `obsidian`, `idb`, or `@/storage/...` imports.
- AC8: PASS — Side-effect import `import './chat/widgets/RagWidget'` lives in `src/ui/chatView.tsx:62` (added in F02), reached transitively by `src/main.ts:24`'s `import { ChatView } from '@/ui/chatView'`. The widget registry contains the `'rag'` kind by the time any chat view mounts. `MessageList` already gracefully handles a missing kind in the registry (no-op render path), so the absent-registration scenario is covered.
- AC9: PASS — `src/ui/ragCommand.ts:21` logs `info` on invoke entry; line 31 logs `warn` on collector failure. `grep -nE "console\\." src/ui/ragCommand.ts src/main.ts | grep -v "consoleImpl"` finds no `console.log` calls. Logging on the snapshot side is covered by F01's `Logger` instrumentation in `src/rag/ragSnapshot.ts`.
- AC10: PASS — Typecheck (`tsc --noEmit`) clean, lint clean (0 errors, 0 warnings), all exports named (`createRagCommand`, `isRagSlashCommand`, constants, types), no default exports.

## Scope coverage

- In scope "New module `src/ui/ragCommand.ts`": PASS — file present with `createRagCommand`, regex/constants/helper.
- In scope "ChatView.deps extended with `collectRagSnapshot`": PASS — `src/ui/chatView.tsx:97`.
- In scope "ChatView slash registry block extended with `/rag`": PASS — `src/ui/chatView.tsx:556–571`.
- In scope "Optional palette command registration": PASS — `src/main.ts:1013–1025`.
- In scope "main.ts wiring with vectorStore/vaultIndexer/graphCache/excludeStore + embeddingModel": PASS — `src/main.ts:610–618`.
- In scope "Import side effect to register the rag widget at startup": PASS — covered by `import './chat/widgets/RagWidget'` in `chatView.tsx:62`.
- In scope "Unit tests under tests/unit/...": PASS — `tests/unit/ragCommand.test.ts` (6 tests). Path differs from spec proposal (flat layout) — documented as deviation in `impl-1.md`.

## Out-of-scope audit

- Out of scope "Snapshot computation logic (F01)": CLEAN — F03 imports `createRagSnapshotCollector` from F01 but adds no collection logic.
- Out of scope "Widget rendering / styling (F02)": CLEAN — no edits to `RagWidget.tsx` or `styles.css`.
- Out of scope "Inline updates of the widget after append": CLEAN — one-shot snapshot per invoke; widget message is immutable once appended.
- Out of scope "Settings UI / status-bar changes": CLEAN — no edits to `SettingsTab.ts` or `indexerStatusBar.ts`.
- Out of scope "Tab-completion or fuzzy-match changes": CLEAN — no edits to `SlashPicker.tsx` or `slashCommands.ts`.

## QA aggregate

`qa-1.md` Verdict: PASS. Typecheck (0), Lint (0), Tests (1357 passed, 0 failed; +6 from `tests/unit/ragCommand.test.ts`), Build (0).

## Verdict: PASS
