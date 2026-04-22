# Compliance iteration 1 — F27 vault-indexer-dirty-queue

## Acceptance criteria

- AC1: PASS — `VaultIndexer.init()` at `src/indexer/vaultIndexer.ts:104` reads the header via `readIndexHeader`, compares via `headerMatches`, emits `indexer.header.match` on match (`:139-141`) or `indexer.header.mismatch` + routes through `promptHeaderMismatch()` → logs `indexer.header.user-choice{choice}` (`:118-125`); `now` branch enumerates `files.listMarkdown()` and marks every path dirty (`:129-134`). Asserted by `tests/unit/vaultIndexer.test.ts` "logs header.match…", "mismatch + 'now' choice marks every markdown path dirty…", and "mismatch + 'later' choice parks indexer…".
- AC2: PASS — `runDiffSweep()` at `src/indexer/vaultIndexer.ts:231-252` computes `diffManifest(stored, current)`, enqueues union of `added ∪ modified ∪ removed`, emits `indexer.diff.complete{added, modified, removed}` counts only. Asserted by `tests/unit/vaultIndexer.test.ts` "diff sweep pushes added / modified / removed paths from manifest comparison".
- AC3: PASS — Listeners registered via `registerListeners()` at `src/indexer/vaultIndexer.ts:218-229` through the injected `VaultEventSource.on(handler)`; rename at `:222-225` emits delete-of-`oldPath` + create-of-`newPath` pair by enqueuing both. Unsubscribe returned from `events.on(...)` stored as `unsubscribeEvents`, called in `shutdown()` (`:209-210`); in the Obsidian wire-up `plugin.registerEvent` auto-disposes on `onunload` anyway. Asserted by "vault events fan out to enqueueDirty — rename emits delete+create pair".
- AC4: PASS — `enqueueDirty` filters at `src/indexer/vaultIndexer.ts:160-164`; logs `indexer.skip.non-markdown{path, extension}` at debug; `.canvas` / `.pdf` / `.png` never enter the queue. Asserted by "markdown-only filter rejects non-md extensions (.canvas, .pdf, .png)".
- AC5: PASS — Idle timer at `src/indexer/vaultIndexer.ts:273-281` fires `processDueWork(signal)` with a fresh `AbortController`; `queryOnDemand(signal)` at `:189-213` pre-empts with `clearIdleTimer()` (`:197`); mutual exclusion via the `draining` flag (`:172-176`, `:194-196`, and `finally` clauses at `:182-187`, `:207-213`); linked `AbortController` released in `finally`. Asserted by "processDueWork drains the queue path by path…", "concurrent drains are mutually exclusive", "abort-during-drain releases the in-flight flag via finally".
- AC6: PASS — `processDueWork` awaits idle ticks via `awaitIdleTick()` at `src/indexer/vaultIndexer.ts:291-298`, runs `chunkIteration(batch, deadline, minChunkBudget=5)` (`:179`), processes the `now` slice and yields back. `chunkIteration` is unit-tested at `tests/unit/chunkIteration.test.ts` (4 cases: full-budget, mid-drop, zero-budget, empty).
- AC7: PASS — `DirtyQueue.persist` debounces atomic writes to `DIRTY_QUEUE_PATH = '.leo/index/queue.json'` with `{version:1, paths:[]}` payload (`src/indexer/dirtyQueue.ts:78-92`); `DirtyQueue.load()` rehydrates before `init()` runs the diff sweep (`src/indexer/vaultIndexer.ts:105`). Asserted by "queue.json persistence survives a simulated init() rerun" and `tests/unit/dirtyQueue.test.ts` "load rehydrates from queue.json and survives restart".
- AC8: PASS — Full Vitest suite enumerated: header-match + all three user-choice branches (4 tests), diff sweep (1), rename pair fan-out (1), markdown-only rejection (1), idle-timer drain (`processDueWork drains…`), on-demand pre-emption + cap (1), mutual exclusion (1), abort-during-drain (1), `requestIdleCallback` budget via `chunkIteration` util (4 separate tests), `queue.json` persistence + reload (1 + `load rehydrates` in DirtyQueue), abort-releases-in-finally (1).

## Scope coverage

- In scope "`VaultIndexer` module with `init / enqueueDirty / processDueWork / queryOnDemand / shutdown` + in-memory `model/dim/version`": PASS.
- In scope "`IndexHeader` read path + 3-choice mismatch routing": PASS — user-choice prompt injected.
- In scope "initial vault-diff sweep with `indexer.diff.complete` counts": PASS.
- In scope "`DirtyQueue` listener registration + rename pair": PASS.
- In scope "lazy drain (idle timer) + on-demand drain + mutual exclusion + abort finally": PASS.
- In scope "markdown-only filter": PASS.
- In scope "off-main-thread yielding via `requestIdleCallback` with `chunkIteration` util": PASS.
- In scope "`queue.json` persistence + reload across restarts": PASS.
- In scope "`processPath` seam for downstream features": PASS — single injectable callback.
- In scope "structured log events (10 enumerated names)": PASS — `indexer.header.match/mismatch/user-choice`, `indexer.diff.complete`, `indexer.enqueue`, `indexer.queue.persisted`, `indexer.drain.start/tick/complete`, `indexer.skip.non-markdown` emitted.

## Out-of-scope audit

- Out of scope "chunking + metadata extraction": CLEAN — `processPath` is a seam, no chunking logic added.
- Out of scope "embeddings + IndexedDB": CLEAN — no IndexedDB / EmbeddingClient references.
- Out of scope "Indexer UI (status bar, palette command, CTA)": CLEAN — only the blocking prompt (injected fn).
- Out of scope "exclude list": CLEAN — markdown-only is the sole filter.
- Out of scope "graph cache": CLEAN — no graph module touched.
- Out of scope "canvas parsing": CLEAN — `.canvas` is rejected by markdown-only filter.

## QA aggregate
Verdict: PASS — typecheck/lint/467-tests/build all green.

## Verdict: PASS
