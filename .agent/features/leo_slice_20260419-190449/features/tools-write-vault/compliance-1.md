# Compliance iteration 1 — F19 tools-write-vault

## Acceptance criteria

- AC1 (both tools registered at onload with source=builtin + description + `{path, content}` schema): PASS — `src/main.ts` registers both after `read_note`; `ToolRegistry.listFor(thread)` returns all three; tool shape in `src/tools/writeTools.ts:37-55` and `:72-92` matches. Tests: `writeTools.test.ts` "happy path writes new file…" covers spec shape + append version.
- AC2 (both expose `requiresConfirmation: true`; F17 suspends invocation until decision): PASS — `src/tools/writeTools.ts:46` and `:80` both set `requiresConfirmation: true`. F17's `invokeWithConfirmation` path in `AgentRunner.drive` already awaits confirmation before calling `ToolRegistry.invoke` (tested in F17). The write tools inherit that gating by construction.
- AC3 (`create_note` calls `vault.write(path, content)` returning `{ok:true, data:{path, bytesWritten}}`; `append_to_note` resolves existing file and appends, returning `{ok:true, data:{path, bytesAppended}}`): PASS — see tests "happy path writes new file via vault.write and returns bytesWritten" + "happy path appends with newline separator + returns bytesAppended".
- AC4 (traversal guard rejects before any Vault call): PASS — both `validate()` calls reject `../`, `/`-prefixed, and malformed paths before `invoke` is entered. Tests: "traversal-unsafe path rejected during validate before vault contact", "traversal rejection via validate before vault contact" both assert `vault.writeCalls === 0`.
- AC5 (platform failures surface as `{ok:false, error}` with no exception escape; log event on error): PASS — both `invoke` bodies wrap Vault calls in try/catch returning `{ok:false, error}`. `tool.invoke.error` is emitted by the registry's `invoke` wrapper (F16) when the tool returns `{ok:false}`. Test: "no invoke throws — platform errors surface as {ok:false}".
- AC6 (exactly one Vault write call per success; vault untouched on failure): PASS — tests track `vault.writeCalls` counter: happy paths = 1, already-exists / not-found / traversal paths = 0.
- AC7 (Vitest covers all paths): PASS — 9 cases covering registration, confirmation flag, all success + failure + traversal paths, and exception surface.

## Scope coverage

All in-scope items covered — see ACs. No out-of-scope leaks.

## Out-of-scope audit

- Out of scope "Active-note `edit_note` with CM6 lock": CLEAN — not added here; F20 will.
- Out of scope "CM6 grouped EditorTransaction + single undo": CLEAN — no CM6 code in writeTools.
- Out of scope "`search_vault`": CLEAN — not added.
- Out of scope "Confirmation dialog UI": CLEAN — only the `requiresConfirmation: true` flag is declared; dialog owned by F17.
- Out of scope "Plan-mode gating": CLEAN — not layered on the write tools.

## QA aggregate

Verdict: PASS (typecheck, lint, 352/352 tests, build ~223 KB).

## Verdict: PASS
