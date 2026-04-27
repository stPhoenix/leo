# Compliance iteration 1 — F02 result-writer

## Acceptance criteria

- AC1: PASS — `write()` mkdirs the folder, then writes `request.md` + `response.md` in order, then iterates files (`resultWriter.ts:181-228`); per-file calls are atomic via single `vault.write` / `vault.writeBinary` calls (NFR-EXT-03).
- AC2: PASS — On any failure, writer continues to flush, emits `error.md` with code/message + partial inventory (`resultWriter.ts:230-265`); returns `{ ok:false, folder, writtenFiles, error }` instead of throwing. Tested in "partial-write failure flushes error.md" + "emits error.md when caller passes pre-existing error".
- AC3: PASS — `buildRequestMarkdown` emits frontmatter with `runId`, `adapter`, `threadId`, `startedAt`, `endedAt`, `status` (`resultWriter.ts:111-138`). Tested.
- AC4: PASS — `sanitizeRelPath` rejects empty, NUL, leading `/` or `\`, drive letter, `..` segment (`resultWriter.ts:56-101`); returns `error.code='invalid_path'`. All cases tested in `sanitizeRelPath` describe block.
- AC5: PASS — `ExcludeListStore.ensureDefaultPrefix` is idempotent (`excludeListStore.ts:62-77`); persists across `set()` via the `defaults` set (`excludeListStore.ts:34-45`). Tested in "is idempotent" + "persists across set()".
- AC6: PASS — `DirtyQueue.add()` short-circuits on `EXTERNAL_AGENT_RESULTS_PREFIX` (`dirtyQueue.ts:51-56`). Tested — `enqueue` count stays 1 after multiple `externalAgentResults/...` adds.
- AC7: PASS — Both new test files green under `pnpm test` (162 files / 1450 tests).

## Scope coverage

- In scope `src/agent/externalAgent/resultWriter.ts`: PASS — file present, `write()` and template helpers exported.
- In scope `request.md and response.md content templates`: PASS — `buildRequestMarkdown` + raw text body for `response.md`.
- In scope `error.md template`: PASS — `buildErrorMarkdown`.
- In scope `Path sanitizer`: PASS — `sanitizeRelPath` covers all rejection classes.
- In scope `Idempotent registration of externalAgentResults/ prefix into excludeListStore`: PASS — `ensureDefaultPrefix` + wired in `wireIndexerRag.ts:181`.
- In scope `dirtyQueue.add() filter`: PASS — `DROP_PREFIXES` + early return.
- In scope `Unit tests`: PASS — `resultWriter.test.ts` + `excludeWiring.test.ts` shipped.

## Out-of-scope audit

- Out of scope `Subgraph state transitions that call the writer (F05)`: CLEAN — writer is invoked by no module yet (subgraph lands in F05).
- Out of scope `Adapter-side file emission`: CLEAN — no adapter implementations.
- Out of scope `UI surface for opening the result folder`: CLEAN — UI is F08.

## QA aggregate

PASS (typecheck + lint + tests + build all green). Integration gate: `EXTERNAL_AGENT_RESULTS_PREFIX` and `ensureDefaultPrefix` reachable from `src/main.ts` via the `wireIndexerRag` call in `main.ts:606`. `ResultWriter` itself is invoked by the subgraph (F05) — module is not entry-reachable yet, but its in-scope wiring (exclude + dirtyQueue) is. New module without wiring bullet: ResultWriter sits behind the subgraph hand-off planned in F05; flagged as integration note rather than a gap because no F02 in-scope bullet asserts entry-point wiring of the writer itself.

## Integration notes

- `ResultWriter` (the class) is not yet referenced from `src/main.ts`; its consumer (subgraph run-phase) lands in F05. F02's wiring scope covers only the exclude store + dirty queue intake filter, both of which are reachable from the entry point.

## Verdict: PASS
