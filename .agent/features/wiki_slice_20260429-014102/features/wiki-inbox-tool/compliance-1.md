# Compliance iteration 1 — F14 wiki-inbox-tool

## Acceptance criteria
- AC1: PASS — `parseInbox` records original `lineIndex` per row and emits `otherLines` for non-matching content; `serializeInbox` rehydrates by index. Test "serializeInbox round-trips when no edits applied (byte-identical for non-row lines)".
- AC2: PASS — Tool sets `isReadOnly:true`, `requiresConfirmation:false`, `source:'builtin'`. `appendRow` produces `- [ ] <ref>  <!-- <note> -->\n`. Tests "registered as read-only, no confirmation, builtin" + "appends one well-formed line".
- AC3: PASS — `tickRef` returns input verbatim when no row needs flipping. Test "is idempotent — ticking already-done leaves text unchanged".
- AC4: PASS — `annotateErrorOnRef` only mutates `error`. Test "appends error annotation while preserving open status" + "does not flip checkbox state on done rows either".
- AC5: PASS — Test file covers parse, parse + tick, parse + annotate, idempotency.

## Scope coverage
- In scope "Parser turning wiki-inbox.md into typed rows; non-matching lines preserved verbatim": PASS.
- In scope "inbox_add registered with isReadOnly:true, no confirmation": PASS.
- In scope "tick(ref) — flips `- [ ]` to `- [x]` in place": PASS via `tickRef`.
- In scope "annotateError(ref, code, msg) — appends `<!-- error: <code>: <msg> -->` while preserving the unticked checkbox": PASS via `annotateErrorOnRef`.

## Out-of-scope audit
- Out of scope "actually invoking ingest from inbox (F15)": CLEAN — no ingest call from F14 modules.
- Out of scope "cleanup of ticked items": CLEAN — OQ-3 noted in impl-1.md.

## QA aggregate
QA verdict: PASS (typecheck/lint/2235 tests/build all PASS).

## Integration notes
- `inboxAdd.ts` reaches `main.ts:98,773` (import + register).
- `inbox/parse.ts` reaches `main.ts` transitively via the tool; F15 will consume `tickRef` / `annotateErrorOnRef` directly.
- No stub bodies (§5.3.2): every helper has a real body.

## Verdict: PASS
