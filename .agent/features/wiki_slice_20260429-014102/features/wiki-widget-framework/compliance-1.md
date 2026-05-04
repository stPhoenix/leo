# Compliance iteration 1 — F06 wiki-widget-framework

## Acceptance criteria
- AC1: PASS — `WikiLiveBlock.tsx:24-29` calls `lookupWikiLiveController(runId)` and renders `<WikiWidget controller={live}/>` when present. Test "renders the registered live controller for runId".
- AC2: PASS — `WikiWidget.tsx:PhaseBody` switch covers every ingest phase (`preparing`, `awaiting_clarify`, `fetching`, `persisting`, `awaiting_duplicate`, `planning`, `extracting`, `reducing`, `writing`) and every lint phase (`scanning`, `checking`, `proposing`, `awaiting_confirm`, `writing` shared) plus terminal `done`/`cancelled`/`error`. Tests cover refining transcript, clarify form, fetch progress, duplicate prompt, awaiting_confirm + Accept-all forwarding, error block.
- AC3: PASS — `WikiWidgetController.toTerminalSnapshot()` validates via `WikiTerminalSnapshotSchema.parse` (Zod). Block kind switch from `WIKI_LIVE_KIND` → `WIKI_TERMINAL_KIND` is caller-driven (F11/F18 will perform the message-store rewrite at terminal); the framework provides `tryParseWikiTerminalSnapshot` for the persisted side. Live-controller release is wired in F04's `releaseWikiLiveController`. Test "toTerminalSnapshot from a done view is Zod-valid".
- AC4: PASS — `WikiTerminalBlock.tsx` renders collapsed one-line summary in a button; toggle expands to `<dl>` with run id, op, duration, per-phase counts, schema-edited (lint), error, log line, and per-source statuses (ingest). Test "renders collapsed summary line and toggles expanded body".
- AC5: PASS — `WikiLiveBlock.tsx:30-33` falls back to `WikiWidgetController.reloadRehydrate(...)` when `lookupWikiLiveController` returns null. `reloadRehydrate` seeds `phase='error', error.code='reload'`. Tests "reloadRehydrate produces error.code=reload" + "rehydrates to error.code=reload when controller missing".
- AC6: PASS — `tests/unit/wikiTerminalSnapshot.test.ts` covers Zod parse/reject/round-trip; `tryParseWikiTerminalSnapshot` returns null on malformed input. No sensitive fields are persisted: snapshot fields are limited to ids, counts, status enums, error codes/messages, log line — no raw content, no extractor/reducer body, no source body.
- AC7: PASS — `WikiWidget.stories.tsx` exports IdleIngest, Preparing, AwaitingClarify, Fetching, PersistingDuplicate, Planning, Extracting, Reducing, Writing, IngestDone, Cancelled, ErrorReload, ErrorOther, Scanning, Checking, AwaitingConfirm, LintDone — every variant required by the AC.

## Scope coverage
- In scope "WikiWidgetController exposing viewModel() per phase + action handlers": PASS — controller + action surface covers clarify, duplicate, lint confirm, cancel.
- In scope "WikiLiveBlock registered under WIKI_LIVE_KIND, looks up controller via liveControllerRegistry": PASS — `registerWidget(WIKI_LIVE_KIND, WikiLiveBlock)` at module bottom; side-effect imported from `main.ts`.
- In scope "WikiTerminalBlock registered under WIKI_TERMINAL_KIND, renders persisted WikiTerminalSnapshot": PASS — `registerWidget(WIKI_TERMINAL_KIND, WikiTerminalBlock)`.
- In scope "WikiTerminalSnapshot Zod schema with schemaVersion:1; sensitive-field filtering before persistence": PASS — schema literal `schemaVersion: 1`, defaulted; snapshot intentionally excludes raw/extractor/reducer/source body fields.
- In scope "Reload rehydration: any non-terminal snapshot at reload becomes error.code='reload'": PASS — `WikiWidgetController.reloadRehydrate`.
- In scope "Storybook stories covering every phase view-model variant": PASS — see AC7.

## Out-of-scope audit
- Out of scope "ingest/lint subgraph state production (F11/F18)": CLEAN — the framework accepts `update(patch)` calls and renders; no subgraph driver code in this slice.
- Out of scope "slash commands": CLEAN — no slash command added (separate features wire `/wiki-ingest` + `/wiki-lint`).
- Out of scope "tool wiring": CLEAN — no `ToolRegistry.register` call in F06.

## QA aggregate
QA verdict: PASS (typecheck/lint/2156 tests/build all PASS).

## Integration notes
- `WikiLiveBlock` + `WikiTerminalBlock` reach `main.ts:147-148` via side-effect imports — registers fire on plugin load. Anchor `WIKI_LIVE_KIND`/`WIKI_TERMINAL_KIND` confirmed in `main.ts` import section. §5.3.1 PASSes.
- `WikiWidgetController`, `WikiViewModel`, `WikiTerminalSnapshot` reach `main.ts` transitively through the two block files; F11/F18 will instantiate controllers directly.
- F04's `liveControllerRegistry.ts` now has its first runtime consumer through `WikiLiveBlock`; the workspace audit at end-of-run will see this transitive reach.
- No stub bodies (§5.3.2): every controller method, every phase render, every block component has a functional implementation. Action callbacks are *optional* by design (subgraph drivers wire them); when absent the dispatch is a documented no-op (`this.actions.cancel?.()`), which is functional behaviour ("cancel before subgraph wired = nothing happens"), not a stub.

## Verdict: PASS
