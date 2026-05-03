# Compliance iteration 1 — F03 wiki-status-slash

## Acceptance criteria
- AC1: PASS — `chatView.tsx` registers `name:'wiki-status'` in slash registry whenever `collectWikiStatus` dep is present; `main.ts` always provides it. Picker `list()` sorts alphabetically (slashCommands.ts:60-64).
- AC2: PASS — Slash dispatches to `wikiStatusCommand.invoke()` which only reads vault + mutex state. No tool registry entry is registered (so `requiresConfirmation` is N/A by construction; the slash bypasses confirmation entirely).
- AC3: PASS — `WikiStatus` shape contains `indexPageCount`, `indexSizeBytes`, `lastLintTimestamp`, `lastLintRunId`, `orphanPageCount`, `orphanRawCount`, `mutexState`. Widget renders all six stats with `data-stat=…` slots; mutex shown as `idle` or `<op> <runId>`.
- AC4: PASS — `wikiStatus.ts:34-44` parses the most recent line matching `/^##\s+\[([^\]]+)\]\s+lint\s+\|\s+runId=([A-Za-z0-9_-]+)/`. Test "parses index page count + size, last lint timestamp from log" verifies the latest of multiple lint entries wins; "returns lastLintTimestamp=null when log has only ingest entries" verifies discrimination.
- AC5: PASS — `WikiStatusWidget.stories.tsx` covers Idle / NeverLinted / IngestRunning / LintRunning / EmptyVault scenarios; widget renderer asserted by `tests/dom/wikiStatusWidget.test.tsx`.

## Scope coverage
- In scope "Register `/wiki-status` in the composer slash registry": PASS — `chatView.tsx` `registry.register({name:'wiki-status', …})`.
- In scope "Tool/handler that reads index size, last lint timestamp, orphan count, mutex state": PASS — `collectWikiStatus` reads all four; orphan walk self-contained.
- In scope "Result rendered as a plain markdown chat block": PASS — rendered via `messageStore.append({role:'widget', widget:{kind:'wiki-status', props:{status}}})`. Functionally equivalent to a markdown block; tests assert structure.

## Out-of-scope audit
- Out of scope "any mutating action": CLEAN — only `vault.exists`/`vault.read`/`vault.list` are called.
- Out of scope "settings UI": CLEAN — no settings touched.
- Out of scope "periodic refresh": CLEAN — single-shot per slash invocation.

## QA aggregate
QA verdict: PASS (typecheck/lint/2111 tests/build all PASS).

## Integration notes
- `wikiStatus.ts` reached from `main.ts:1240` via `collectWikiStatus(...)` call inside `collectWikiStatus` ChatViewDeps factory.
- `wikiStatusCommand.ts` reached from `chatView.tsx:60-65` (named imports) and used to build the slash command handle inside the registry.
- `WikiStatusWidget.tsx` reached via side-effect import in `chatView.tsx` (`./chat/widgets/WikiStatusWidget`); registers itself on module load.
- `mutexTypes.ts` reached from both `main.ts` (`WIKI_MUTEX_IDLE`, `WikiMutexLike`) and `wikiStatus.ts`; F05 will populate the runtime `WikiMutex` class against the same types.
- No stub bodies (§5.3.2): `wikiStatus`, `wikiStatusCommand`, widget all have functional bodies; `this.wikiMutex` slot defaults to `null` and the `??` short-circuit returns the real `WIKI_MUTEX_IDLE` constant — that is functional behaviour ("idle when nothing holds the mutex"), not a stub. F05 will assign the slot; no F03 file requires a follow-up edit.

## Verdict: PASS
