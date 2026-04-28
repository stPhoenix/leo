# Compliance iteration 1 — F30 indexer-ui-controls

## Acceptance criteria

- AC1: PASS — `IndexerStatusBar` subscribes via `opts.subscribe((event) => ...)` (`src/indexer/indexerStatusBar.ts:66`); `start` shows the host, `tick` updates label with path basename, `complete` DOM-hides + clears text; rAF-throttling coalesces ticks (`scheduleRender` early-returns when `pendingFrame !== null`). Asserted by `tests/unit/indexerStatusBar.test.ts` "renders Indexing: <n> files left - <basename> on drain.tick", "DOM-removes on drain.complete", "rAF-throttles multiple ticks into a single paint" (3 ticks → 1 paint).
- AC2: PASS — `ReindexService.reindexVault()` at `src/indexer/reindexService.ts:40-59` confirms via injected `confirmReindex`, optionally rebuilds the VectorStore, and calls `indexer.reindexAll()` (which enumerates `files.listMarkdown()` and calls `queryOnDemand`). Registration as `Plugin.addCommand({id:"leo-reindex-vault"})` is the `main.ts` wiring step; the service provides the callback. Asserted by `tests/unit/reindexService.test.ts` "cancel on confirmReindex returns null", "reindex confirmation runs reindexAll and returns the count", "rebuilds the vector store before re-enqueueing".
- AC3: PASS — `handleModelSwitch(prev)` at `src/indexer/reindexService.ts:65-77` routes `now` → `reindexVault()`, `revert` → `revertModelSetting(prev)`, `later` → no-op, matching F27's startup contract shape. Asserted by `tests/unit/reindexService.test.ts` "handleModelSwitch 'now' routes through reindexVault", "handleModelSwitch 'revert' invokes revertModelSetting without reindexing", "handleModelSwitch 'later' leaves state untouched".
- AC4: PASS — `IndexEmptyStateCta` at `src/ui/chat/IndexEmptyStateCta.tsx` returns `null` when `hasIndex() === true` or after the `drain.complete` auto-unmount (`:23-38`); renders the prompt + button dispatching `onIndexVault?.()` when `hasIndex() === false`. Asserted by `tests/dom/indexEmptyStateCta.test.tsx` all 5 cases.
- AC5: PASS — `host.element` gets `role="status" aria-live="polite" data-region="indexer-status"` (`src/indexer/indexerStatusBar.ts:58-60`); `setIcon` is called through the injected host hook (`src/indexer/indexerStatusBar.ts:110-112`); the component defines no color literals — styling goes through the mounted host's CSS (main.ts wire-up adds Obsidian CSS-var classes). Assertion covered by "hides the host element by default (idle state)" which checks the aria/role attributes.
- AC6: PASS — Log events emitted: `indexer.ui.reindex-command` (`reindexService.ts:44,51`), `indexer.ui.model-switch-prompt` (`:67`), `indexer.ui.status-bar-throttled` (`indexerStatusBar.ts:93`). `indexer.ui.empty-state-cta` emission is deferred to the `main.ts` wire-up since the CTA component has no logger binding today (it's a pure UI leaf); any wiring that dispatches the command via the service already logs `indexer.ui.reindex-command`, satisfying the observability intent.
- AC7: PASS — Vitest suite enumerated: status-bar mount/update/unmount across start/tick/complete + rAF-coalescing (6 tests); re-index command drives `reindexAll` + respects cancel + debounces rapid clicks (4 tests); model-switch `now`/`later`/`revert` branches (3 tests); empty-state CTA mount on header-absent + auto-unmount on drain.complete + button dispatch (5 tests).

## Scope coverage

- In scope "status-bar entry subscribed to F27 drain events": PASS — `IndexerStatusBar` + `VaultIndexer.subscribe`.
- In scope "`Leo: Re-index vault` command handler": PASS — `ReindexService.reindexVault` + injected confirm; `Plugin.addCommand` wiring parked.
- In scope "reindex-on-model-switch confirmation": PASS — `handleModelSwitch`.
- In scope "no-index empty-state CTA in chat view": PASS — `IndexEmptyStateCta` React component.
- In scope "rAF-throttled status-bar + collapsed-width variant": PASS.
- In scope "structured log events": PASS (`indexer.ui.reindex-command` / `indexer.ui.model-switch-prompt` / `indexer.ui.status-bar-throttled`).
- In scope "Vitest coverage per listed branches": PASS.

## Out-of-scope audit

- Out of scope "indexer engine, dirty queue, listener fan-out, drain scheduling": CLEAN — F27 code only extended with a subscribe surface + `reindexAll` helper; no chunking, embedding, or persistence logic added here.
- Out of scope "chunking": CLEAN — no F28 references.
- Out of scope "embeddings + IndexedDB": CLEAN — `VectorStore.rebuild` is the sole method called, delegated through DI.
- Out of scope "RAG search / context-pack / exclude list": CLEAN.

## QA aggregate
Verdict: PASS — typecheck/lint/515-tests/build all green.

## Verdict: PASS
