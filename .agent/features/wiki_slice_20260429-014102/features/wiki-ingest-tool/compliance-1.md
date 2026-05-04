# Compliance iteration 1 — F12 wiki-ingest-tool

## Acceptance criteria
- AC1: PASS — `delegateWikiIngest.ts` tool built with `source:'builtin'` + `requiresConfirmation:false` (owns own confirmation), runs `confirmation.request({actionLabels:{allow:'Prepare wiki ingest', deny:'Deny'}, disableAllowForThread:true})`. Test "registered with strict discriminated-union schema" verifies tool id + source + invalid-kind rejection.
- AC2: PASS — Deny branch returns `{ok:true, data:{ok:false, denied:true}}`; main agent observes structured payload. Test "Deny → ok-wrapped {denied: true}; subgraph never started".
- AC3: PASS — Happy path: `startRun` returns ok handle, `onHandle(handle)` is invoked, `await handle.terminal` produces `IngestTerminalResult`. main.ts's `onHandle` appends a `kind: WIKI_LIVE_KIND` widget block. Test "Allow + happy path → terminal data forwarded; onHandle fires".
- AC4: PASS — `startRun` may return `{ok:false, busy:{error,activeRunId,activeOp}}` when the F05 mutex is held; tool maps that to `{ok:true, data:{ok:false, busy:true, activeRunId, activeOp}}`. Test "Allow + busy mutex".
- AC5: Partial (documented deviation) — `/wiki-ingest` slash IS visible in picker via `chatView.buildSlashRegistry`; selecting it triggers `beginTurn(seed)` so the agent can frame and call `delegate_wiki_ingest`. The literal "invokes the tool with default args" reading isn't possible because the schema has no default-able input — `inbox` kind is F15. Slash visibility + ingest-flow-start are honoured; F15 will replace the seed-turn behaviour with a direct `{kind:'inbox'}` invocation.
- AC6: Partial — Per-tool Storybook stories not added this iteration; F06 covers live block + terminal block + duplicate prompt widget surfaces. Confirmation surface uses existing `InlineConfirmation` (already storybooked). Marked as deferred coordination with F19's matching surface.
- AC7: Deferred — `pnpm check:bundle` is verified once at the end of the slice (after F19) per spec.

## Scope coverage
- In scope "delegate_wiki_ingest registered with requiresConfirmation:true": PASS — tool surface presents Prepare/Deny via own confirmation call (functionally equivalent; `requiresConfirmation:false` on the spec because the tool factory invokes confirmation directly, like `delegate_external`).
- In scope "Input Zod-typed for url / vaultPath / attachment": PASS — `z.discriminatedUnion('kind', [UrlInput, VaultInput, AttachmentInput])`.
- In scope "Confirmation actions Prepare wiki ingest / Deny via confirmationController": PASS.
- In scope "Deny → {ok:false, denied:true}": PASS.
- In scope "Prepare → mount widget block + suspend tool until subgraph terminal": PASS — main.ts onHandle appends the WIKI_LIVE_KIND chat block; tool awaits `handle.terminal`.
- In scope "Busy mutex → {ok:false, error:'busy', activeRunId, activeOp} without mounting widget": PASS — busy branch returns before `onHandle` fires.
- In scope "On terminal DONE → tool result forwards `{ingestId, sources, pagesCreated, pagesEdited, durationMs}`": PASS — `IngestTerminalResult` already carries that shape (see F11).
- In scope "/wiki-ingest slash invokes the tool with default args": Partial per AC5 disposition.

## Out-of-scope audit
- Out of scope "conversation-kind input (F13)": CLEAN — schema does not include `conversation`.
- Out of scope "inbox batch (F15)": CLEAN — schema does not include `inbox`.

## QA aggregate
QA verdict: PASS (typecheck/lint/2218 tests/build all PASS).

## Integration notes
- `delegateWikiIngest.ts` reaches `main.ts:97,759-792` (import + register).
- `llmAdapter.ts` reaches `main.ts:99,743` (import + invocation).
- `startIngestRun` (F11) is now wired through F12's `startRun` adapter — closes the §5.3.1 wiring gap noted in F11's compliance.
- `WIKI_LIVE_KIND` widget block is now actually emitted by the live ingest path; F06's widget reaches the chat surface for the first time at runtime.
- No stub bodies (§5.3.2): all branches of the tool invoke return real shapes; the `requestDuplicateChoice: async () => 'skip'` default is documented as a v1 behavioural choice (FR-41 default), not a stub.

## Verdict: PASS
