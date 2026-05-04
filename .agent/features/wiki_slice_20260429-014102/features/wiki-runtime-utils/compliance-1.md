# Compliance iteration 1 — F04 wiki-runtime-utils

## Acceptance criteria
- AC1: PASS — `budgets.ts:1-10` exports `WIKI_BUDGETS` `as const` with the eight required keys at the spec'd values. Test "exports the eight token caps from NFR-WIKI-10 with the spec values" asserts exact match.
- AC2: PASS — `loggingNamespaces.ts` exports `WIKI_LOG` namespace tree and `WIKI_SENSITIVE_FIELD_KEYS`. Test verifies tree structure + presence of raw/extractor/page/source body keys.
- AC3: PASS — `runIdRegistry.ts:generateWikiRunId` formats `YYYYMMDD-HHmmss-<tail>`, deterministic given `now`+`tail`, default tail 6 alphanumeric chars. Test "formats … deterministically" + "two calls with the same fixed time + tail produce identical ids".
- AC4: PASS — `liveControllerRegistry.ts` `registerWikiLiveController` overwrites the same key (idempotent in count); `releaseWikiLiveController` calls `dispose` once then deletes; subsequent release of same id is a no-op; dispose throws swallowed. All four assertions covered.
- AC5: PASS — None of the four files import `react`, `react-dom`, `obsidian`, `@codemirror/*`, `@langchain/*`, or DOM types. Confirmed by grep + `tsc --noEmit` PASS (no DOM types resolved).
- AC6: PASS — Each module has its own dedicated test file (`wikiBudgets.test.ts`, `wikiLoggingNamespaces.test.ts`, `wikiRunIdRegistry.test.ts`, `wikiLiveControllerRegistry.test.ts`).

## Scope coverage
- In scope "budgets.ts exporting eight as const token caps": PASS.
- In scope "loggingNamespaces.ts exporting wiki.* namespaces": PASS.
- In scope "runIdRegistry.ts exporting generateWikiRunId": PASS.
- In scope "liveControllerRegistry.ts — Map + register/get/release + WIKI_LIVE_KIND": PASS.

## Out-of-scope audit
- Out of scope "subgraph code": CLEAN — no LangGraph references.
- Out of scope "widget UI code": CLEAN — no React/JSX in any of the four files.
- Out of scope "tools": CLEAN — no `ToolSpec`, no registration calls, no `ToolRegistry` imports.

## QA aggregate
QA verdict: PASS (typecheck/lint/2126 tests/build all PASS).

## Integration notes
- F04 is utility scaffolding consumed by F05+. None of the four modules has a wiring `### In scope` bullet (no register/mount/onload language). Per §5.3.1 the integration gate emits a warning rather than a gap when zero anchors match and no wiring bullet exists.
- These modules will become referenced from `main.ts` (transitively through F05's `WikiMutex`, F06's widget, F11+ subgraph drivers). The workspace audit (§5.4) at end of run will re-verify reachability.
- No stub bodies (§5.3.2): every exported function has a real, deterministic body; no throw-stubs, no TODO bodies.

## Verdict: PASS
