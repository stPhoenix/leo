# Context — Leo Wiki

Source SRS: [.agent/srs/leo-wiki.md](../../srs/leo-wiki.md). Companion docs: [srs.md](../../srs/srs.md), [external-agent.md](../../srs/external-agent.md), [architecture.md](../../architecture/architecture.md).

## Scope

- Vault-local LLM-maintained knowledge base under fixed `wiki/` folder.
- Fixed inbox file `wiki-inbox.md` at vault root.
- Bootstrap of folder layout + seed content (`introduction.md`, `SCHEMA.md`, `index.md`, `log.md`) on plugin load.
- Built-in tools: `search_wiki`, `inbox_add`, `delegate_wiki_ingest`, `delegate_wiki_lint`.
- Ingest LangGraph subgraph: PREPARING → FETCHING → PERSISTING → PLANNING → EXTRACTING → REDUCING → WRITING → DONE/CANCELLED/ERROR.
- Lint LangGraph subgraph: SCANNING → CHECKING → PROPOSING → CONFIRMING → WRITING → DONE/CANCELLED/ERROR.
- Map-reduce subagents: extractor (per source), reducer (per affected page), checker (per concern).
- Re-ingest detection via SHA-256 in raw frontmatter; user resolves skip / re-process / replace.
- Vault-global wiki mutex (one ingest *or* lint at a time).
- Live widget + terminal snapshot mirroring `ExternalAgentLiveBlock` / `ExternalAgentTerminalBlock`.
- Slash commands `/wiki-ingest`, `/wiki-lint`, `/wiki-status`.
- Auto-add of `wiki/` to RAG exclude list; intake filter at `dirtyQueue`.
- Wiki excluded from RAG indefinitely.
- `delegate_wiki_ingest` accepts conversation kind to file an answer/analysis from chat back into the wiki.

## Out of scope

- Image and PDF ingestion (text only).
- Wiki-specific vector or BM25 search engine — `index.md`-first retrieval suffices at v1 scale.
- Auto-ingest on `wiki-inbox.md` write events. Explicit user trigger only.
- Configurable folder name, inbox name, or per-vault enablement toggle.
- Cross-vault wiki sharing.
- Resuming an in-flight ingest or lint subgraph across plugin reloads.
- Git-commit-per-ingest atomicity (rely on `log.md` + best-effort writes).
- Auto-attaching produced wiki pages to the next user turn.
- New user-configurable settings; thresholds live in `budgets.ts`.

## Actors

- **End user** — triggers ingest / lint via tool confirmation, slash commands, or natural-language requests; resolves duplicate prompts and lint findings.
- **Main agent** — calls `search_wiki`, `delegate_wiki_ingest`, `delegate_wiki_lint`, `inbox_add` per `LEO_PREAMBLE` routing rule.
- **Refine sub-agent** — clarifies ingest scope (PREPARING phase), no vault tools.
- **Extractor sub-agent** — per raw entry, returns Zod-validated `ExtractorOutput` with page-op proposals.
- **Reducer sub-agent** — per affected page, merges all extractor proposals into one coherent edit.
- **Planner sub-agent** — single LLM call producing `{ ingestId, perSource[] }` plan.
- **Checker sub-agents** — per concern type (contradiction, stale, orphan, missing-page, missing-xref, research-gap, schema-drift).
- **Inline-agent fetch chain** — `fetch_url` + sanitize from `src/agent/externalAgent/adapters/inlineAgent/tools/`, used by ingest FETCHING phase.
- **VaultAdapter** — abstracts FS for raw / sources / pages / index / log / inbox writes.
- **WikiMutex** — vault-global advisory lock, one holder across threads.

## Functional requirements

### Bootstrap & Layout

- **FR-01** (FR-WIKI-01) — On plugin load, ensure `wiki/`, `wiki/raw/`, `wiki/sources/`, `wiki/pages/`, `wiki-inbox.md` exist. Idempotent.
- **FR-02** (FR-WIKI-02) — On first run only, seed `wiki/introduction.md`, `wiki/SCHEMA.md`, `wiki/index.md` (empty catalog), `wiki/log.md` (empty). Existing files never overwritten.
- **FR-03** (FR-WIKI-03) — `introduction.md` content fixed in `src/agent/wiki/seed/introduction.ts`; describes purpose, wiki-vs-lifestream, source intake, folder map, agent–user authoring policy (agent owns `pages/`, `sources/`, `index.md`; reducer preserves user-authored content where compatible with SCHEMA; lint flags drift as `info` and never auto-rewrites; destructive actions require user confirmation).
- **FR-04** (FR-WIKI-04) — `SCHEMA.md` content fixed in `src/agent/wiki/seed/schema.ts`; describes page naming (kebab-case, one entity per page), wikilink cross-ref `[[pages/<slug>]]`, citation format (`[[sources/<slug>]]` in body, vault-relative path-without-`.md` in structured fields), page structure (H1, optional aliases, body, sources section), Dataview frontmatter (`tags: string[]`, `last_updated: <iso8601>`, `source_count: number`, optional domain fields), source-summary frontmatter (`source_url`, `fetched_at`, `sha256`, `raw_path`), index-entry conventions (one line per page under category headings).
- **FR-05** (FR-WIKI-05) — On plugin load, ensure `wiki/` is in the RAG exclude list (`excludeListStore`). Idempotent. `dirtyQueue` filters `wiki/` at intake.
- **FR-06** (FR-WIKI-06) — `wiki/` and `wiki-inbox.md` names are fixed and not user-configurable.

### Inbox

- **FR-07** (FR-WIKI-07) — `wiki-inbox.md` is markdown checklist of `- [ ] <ref>  <!-- optional note -->`. Non-matching lines ignored.
- **FR-08** (FR-WIKI-08) — `inbox_add(ref, note?)` tool appends one `- [ ] <ref>  <!-- <note> -->` line. Read-only w.r.t. wiki content; no confirmation.
- **FR-09** (FR-WIKI-09) — On successful ingest, parser ticks line to `- [x] <ref>` in place. On failure, line stays `- [ ]` and gets `<!-- error: <code>: <msg> -->`.
- **FR-10** (FR-WIKI-10) — Inbox processing single-flight per item, sequential (concurrency 1). User explicitly invokes via `delegate_wiki_ingest({ source: 'inbox' })`. No auto-ingest on file modify.

### Routing & Wiki Search

- **FR-11** (FR-WIKI-11) — `search_wiki(query, opts?)` registered in `ToolRegistry` at plugin load. Read-only, no confirmation.
- **FR-12** (FR-WIKI-12) — `search_wiki` reads `wiki/index.md` first, picks up to N=8 candidate pages by lexical/heuristic match, reads matched bodies, returns `{ matches: [{ path, summary, snippet, score }], indexConsulted: true }`. Never reads `raw/`.
- **FR-13** (FR-WIKI-13) — `LEO_PREAMBLE` extended with routing rule: knowledge / facts / concepts / entities / research → prefer `search_wiki`; personal / journal / activity → prefer `search_vault`; if `search_wiki` returns no matches and query smells factual, fall back to `search_vault`. Wording lives in `src/agent/types.ts`.
- **FR-14** (FR-WIKI-14) — While ingest or lint in progress, `search_wiki` still serves reads; first line of result includes `"warning: wiki <op> in progress (runId=<id>) — results may be partial"`. Surface as `Notice` toast at most once per minute per thread.

### Ingest Trigger & Confirmation

- **FR-15** (FR-WIKI-15) — `delegate_wiki_ingest(input)` registered in `ToolRegistry`. Description instructs main agent to call it for URL / file / inbox batch ingest **or** to file a current-conversation answer/analysis back as a wiki page.
- **FR-16** (FR-WIKI-16) — `delegate_wiki_ingest` declares `requiresConfirmation: true`. Surface = existing `confirmationController` inline prompt; actions: **Prepare wiki ingest** / **Deny**.
- **FR-17** (FR-WIKI-17) — `input` discriminated union: `{kind:'url',url,note?}` | `{kind:'vaultPath',path,note?}` | `{kind:'attachment',attachmentId,note?}` | `{kind:'inbox'}` | `{kind:'conversation',title,body,citedSources?,note?}`. `conversation` kind skips FETCHING; PERSISTING writes raw entry with `source: 'conversation:<threadId>:<turnIndex>'`, sha256 over body; remaining phases run normally.
- **FR-18** (FR-WIKI-18) — Deny → tool returns `{ ok: false, denied: true }`; main agent continues normally.
- **FR-19** (FR-WIKI-19) — Prepare → ingest subgraph mounts inline widget block; tool call enters suspended state until subgraph terminal.

### Lint Trigger & Confirmation

- **FR-20** (FR-WIKI-20) — `delegate_wiki_lint(scope?)` registered. `scope` = `{kind:'all'}` | `{kind:'pages',glob}` | `{kind:'orphans'}` (default `all`).
- **FR-21** (FR-WIKI-21) — `delegate_wiki_lint` declares `requiresConfirmation: true`. Actions: **Run wiki lint** / **Deny**.
- **FR-22** (FR-WIKI-22) — On Prepare, lint subgraph mounts inline widget block; tool call suspends until terminal.

### Vault-Global Wiki Mutex

- **FR-23** (FR-WIKI-23) — At most one ingest or lint subgraph active across the entire vault. `WikiMutex` holds in plugin-process memory; released on terminal state.
- **FR-24** (FR-WIKI-24) — Second invocation while mutex held returns `{ ok: false, error: 'busy', activeRunId, activeOp: 'ingest' | 'lint' }`. Widget not mounted. Main agent surfaces user-visible message.
- **FR-25** (FR-WIKI-25) — Mutex released in `try/finally` wrapping the subgraph driver. Exceptions, aborts, timeouts all release.

### Ingest Subgraph — Phases

- **FR-26** (FR-WIKI-26) — PREPARING: refine sub-agent clarifies scope when ambiguous; max three clarifying questions (configurable via widget). Allowed actions: `ask_clarifying_question`, `emit_ingest_plan`. No vault tools.
- **FR-27** (FR-WIKI-27) — FETCHING: per source — URL via inline-agent `fetch_url` + sanitize; vault path via `VaultAdapter`; attachment from chat attachment store. Per-source failures recorded; source moves to terminal `error` without aborting batch.
- **FR-28** (FR-WIKI-28) — PERSISTING: each fetched source written to `wiki/raw/<YYYYMMDD>-<slug>.md` with frontmatter `{ source, fetched_at, content_type, sha256, original_path? }`; body = fetched markdown verbatim; raw files immutable post-write.
- **FR-29** (FR-WIKI-29) — PLANNING: single LLM call reads `SCHEMA.md`, truncated `index.md` (top N=200 lines), per-source frontmatter + first M=2000 chars; outputs JSON plan `{ ingestId, perSource: [{ rawPath, candidatePages: string[] }] }`; Zod-validated.
- **FR-30** (FR-WIKI-30) — EXTRACTING: extractor subagents fan out per raw entry, capped by `extractorConcurrency` (default 1, max 2). Inputs: raw content (truncated to `extractorInputCap`=8000 tokens), `SCHEMA.md`, candidate-page list, matching index excerpts. Output Zod-validated, capped at `extractorOutputCap`=1500 tokens. Parse failure → one retry with parser error appended; second failure → source `error: extract_invalid`.
- **FR-31** (FR-WIKI-31) — REDUCING: reducer subagents fan out per affected page, capped by `reducerConcurrency` (default 1). Inputs: current page (or empty for create), all `page_ops` targeting it, `SCHEMA.md`. Output Zod-validated `ReducerOutput`. Parse failure → one retry; second failure → page `error: reduce_invalid`, leave untouched.
- **FR-32** (FR-WIKI-32) — WRITING: deterministic order — page creates → page edits → `sources/` summaries → `index.md` regenerate → `log.md` append. Each file write atomic per-file via `VaultAdapter`. Mid-phase failure leaves prior writes; run continues then terminal `error`.
- **FR-33** (FR-WIKI-33) — DONE: subgraph terminal. `delegate_wiki_ingest` resumes with `{ ok: true, ingestId, sources: [{ rawPath, sourcePath, status }], pagesCreated, pagesEdited, durationMs }`.

### Lint Subgraph — Phases

- **FR-34** (FR-WIKI-34) — SCANNING: enumerate `pages/` and `sources/` only (lint-eligible). Build wikilink adjacency, count inbound/outbound, identify orphans (zero inbound) and orphan raw entries (no `sources/` summary). `index.md` regenerated by ingest WRITING (never linted in place); `log.md` append-only (never linted); `introduction.md` user-only (never read or modified by lint); `SCHEMA.md` is read-only input to checkers, modified only via explicit schema-drift confirmation flow.
- **FR-35** (FR-WIKI-35) — CHECKING: checker subagents fan out per concern: contradiction, stale, missing-page (entities mentioned in ≥ K=3 pages without their own page), missing-xref, research-gap (thin source coverage; advisory; emits `suggestedQueries`; `severity:'info'`; `patch:null`), schema-drift. Output `LintFinding[]`.
- **FR-36** (FR-WIKI-36) — PROPOSING: aggregate findings into ranked patch list `{ page, action, rationale, patch }`. Schema-edit proposals separate `schemaPatch` field, not inline.
- **FR-37** (FR-WIKI-37) — CONFIRMING: surface findings in lint widget. User accepts/rejects per item (multi-select); buttons "Accept all", "Reject all", "Apply selected". Schema patches require explicit per-run confirmation; never auto-apply.
- **FR-38** (FR-WIKI-38) — WRITING: accepted patches via same writer as ingest; schema patches edit `SCHEMA.md`; single `log.md` entry records lint run with accepted/rejected counts.
- **FR-39** (FR-WIKI-39) — DONE: tool resumes with `{ ok: true, lintId, findings: { total, accepted, rejected }, pagesEdited, schemaEdited: boolean, durationMs }`.

### Re-ingest Detection

- **FR-40** (FR-WIKI-40) — During PERSISTING, SHA-256 of body computed before write. If any existing raw file has matching `sha256` in frontmatter, ingest pauses on that source via LangGraph `interrupt()`; widget surfaces choice **Skip** / **Re-process** (re-extract+reduce against existing raw, no new raw write) / **Replace** (overwrite raw with new fetch).
- **FR-41** (FR-WIKI-41) — If user does not respond within `reingestPromptTimeoutMs` (default 60s), source defaults to **Skip** and run continues.

### Cancellation

- **FR-42** (FR-WIKI-42) — Both subgraphs accept `AbortSignal` threaded through `LLM.stream({ signal })` and tool calls. Cancel during PREPARING/PLANNING/EXTRACTING/REDUCING/CHECKING/PROPOSING transitions to `CANCELLED` within ≤ 2 s wall-clock; in-flight outputs discarded.
- **FR-43** (FR-WIKI-43) — Cancel during WRITING completes the in-flight per-file write before transitioning to `CANCELLED`; remaining queued writes skipped; logs `## [<iso>] cancelled-mid-write | <runId>` to `log.md`.
- **FR-44** (FR-WIKI-44) — On cancel, tool returns `{ ok: false, cancelled: true, phase: <last-phase>, partial: { pagesCreated, pagesEdited, sourcesPersisted } }`.

### Error Handling

- **FR-45** (FR-WIKI-45) — Unhandled throw in any subgraph node, extractor/reducer parse failure exhausting retry, or fetch failure on every batch source → `ERROR`.
- **FR-46** (FR-WIKI-46) — On `ERROR`, writer best-effort writes `log.md` entry `## [<iso>] error | <runId> | <code>: <msg>`; tool returns `{ ok: false, error: { code, message }, partial }`.
- **FR-47** (FR-WIKI-47) — Errors do not roll back successfully written pages or raw entries. Cleanup via next `/wiki-lint` (orphan raw entries flagged).

### Widget Lifecycle

- **FR-48** (FR-WIKI-48) — Each ingest or lint run mounts inline assistant message block. `WikiLiveBlock` renders live; controller looked up via `wikiLiveControllerRegistry` keyed by `runId`.
- **FR-49** (FR-WIKI-49) — Live widget surfaces, by phase: refining transcript + clarification input (PREPARING); per-source fetch progress + duplicate prompts (FETCHING/PERSISTING); plan summary (PLANNING); per-source extractor progress (EXTRACTING); per-page reducer progress (REDUCING); per-file write progress (WRITING); confirmation list (lint CONFIRMING).
- **FR-50** (FR-WIKI-50) — After terminal state, controller emits `WikiTerminalSnapshot` replacing live block with `WikiTerminalBlock`: collapsed one-line summary expandable to per-phase counts, per-source statuses, error if any, and the `log.md` line.
- **FR-51** (FR-WIKI-51) — On thread reopen after plugin reload, persisted terminal snapshot re-renders. Live block, if active at reload, rehydrates to `error.code = 'reload'`.

### Slash Commands

- **FR-52** (FR-WIKI-52) — Composer registers `/wiki-ingest`, `/wiki-lint`, `/wiki-status`. Each invokes corresponding tool with default args. `/wiki-status` is read-only; prints index size, last lint timestamp (from `log.md`), live orphan count, current mutex state.

## Non-functional requirements

- **NFR-01** (NFR-WIKI-01) — Cancel surfaces within ≤ 2 s wall-clock from button press to subgraph terminal. Adapters / tools must respect `AbortSignal`.
- **NFR-02** (NFR-WIKI-02) — Subgraph state in-memory only. Plugin reload during non-terminal phase discards run; live block rehydrates to `error.code = 'reload'`.
- **NFR-03** (NFR-WIKI-03) — Logging: every state transition + per-source/per-page event at `debug` under namespaces `wiki.ingest.*` / `wiki.lint.*`; errors at `error`. Raw source content and extractor outputs not logged above `debug`.
- **NFR-04** (NFR-WIKI-04) — Bundle: wiki feature (subgraphs + tools + widgets + seeds + writer + mutex) ≤ 40 KB minified to `main.js`. No new top-level dependency. SHA-256 via existing Web Crypto path.
- **NFR-05** (NFR-WIKI-05) — All subgraph nodes that touch IO wrapped in `try/finally` to guarantee abort cleanup. Wiki mutex released in outermost `finally`.
- **NFR-06** (NFR-WIKI-06) — Both subgraphs unit-testable end-to-end with mock LLM (canned `AsyncIterable` of responses) and fake `VaultAdapter` — no msw / no real provider.
- **NFR-07** (NFR-WIKI-07) — Extractor and reducer outputs Zod-validated. Schema violation → single retry with parser error injected; second failure marks source/page errored without crashing run.
- **NFR-08** (NFR-WIKI-08) — Concurrency caps (`extractorConcurrency`, `reducerConcurrency`) enforced via explicit semaphore module; never ad-hoc `Promise.all`.
- **NFR-09** (NFR-WIKI-09) — Operates correctly when `wiki/` is symlink, Obsidian-synced folder, or fresh empty dir. No FS-specific behavior beyond `VaultAdapter`.
- **NFR-10** (NFR-WIKI-10) — Token budgets in `src/agent/wiki/budgets.ts`: `extractorInputCap=8000`, `extractorOutputCap=1500`, `reducerInputCap=6000`, `reducerOutputCap=2000`, `plannerInputCap=4000`, `plannerOutputCap=1500`, `checkerInputCap=6000`, `checkerOutputCap=1500`. Tunable in code only.

## Constraints

- TypeScript 5 strict, no `any`, no `enum`, no default exports — see [code-style.md](../../standards/code-style.md).
- React 18 function components only; mount via `createRoot` in `ItemView.onOpen`; unmount in `onClose`.
- LangGraph.js subgraphs; subpath imports only (`@langchain/core/messages`, etc.) — see [tech-stack.md](../../standards/tech-stack.md).
- Zod at boundaries (`schema.parse()` in adapter), `z.infer` for TS types.
- All async paths thread `AbortSignal`.
- All FS via `VaultAdapter` — never `app.vault.adapter` direct.
- `MetadataCache` first; read file content only when cache insufficient.
- IndexedDB unused for wiki — wiki content lives in vault FS only (raw / sources / pages / index / log) plus inbox at vault root.
- Tailwind utilities scoped under plugin root class to avoid bleed.
- Bundle budget enforced by `pnpm check:bundle` — see [scripts/checkBundle.mjs path note](../../standards/project-structure.md).
- Logger only — no `console.log` in committed code.
- Concurrency via explicit semaphore module; FIFO via `src/util/fifoQueue.ts`.
- Re-uses existing `confirmationController`, `assistant-block` registry, inline-agent `fetch_url`/sanitize chain, `excludeListStore`, `dirtyQueue`, `slashCommands` module.

## Glossary

- **Wiki** — knowledge-base layer rooted at vault `wiki/`.
- **Lifestream** — non-wiki vault content; indexed by RAG.
- **Inbox** — `wiki-inbox.md` at vault root; checklist of pending ingest items.
- **Raw entry** — file under `wiki/raw/` with original ingested content; immutable post-write.
- **Source summary** — file under `wiki/sources/`; key facts + citations + 1:1 link to raw entry.
- **Page** — file under `wiki/pages/`; describes one entity, concept, or topic.
- **Schema** — `wiki/SCHEMA.md`; conventions agent follows on ingest/lint; user-editable.
- **Introduction** — `wiki/introduction.md`; user-facing description of the wiki.
- **Index** — `wiki/index.md`; catalog of pages with one-line summaries by category.
- **Log** — `wiki/log.md`; append-only chronological record.
- **Ingest subgraph** — LangGraph subgraph under `src/agent/wiki/ingest/`.
- **Lint subgraph** — LangGraph subgraph under `src/agent/wiki/lint/`.
- **Extractor subagent** — LLM call inside ingest, scoped per raw entry; emits page-op proposals.
- **Reducer subagent** — LLM call inside ingest, scoped per affected page; merges proposals.
- **Wiki mutex** — vault-global advisory lock guarding ingest + lint.
- **Run handle** — runtime object returned when subgraph starts; carries `runId`, abort, terminal promise.
- **Live widget** — inline assistant block rendering current subgraph state.
- **Terminal snapshot** — persisted post-terminal payload re-rendered on thread reopen.

## Open questions

- **OQ-1** — Should `search_wiki` accept optional `scope: 'pages' | 'sources' | 'all'` arg in v1? SRS §15(1).
- **OQ-2** — Merge planner subagent into refine sub-agent on small models (one fewer LLM hop)? Measure on Qwen 30B in Phase 5. SRS §15(2).
- **OQ-3** — Inbox failed-item cleanup via `/wiki-inbox-clean` stripping ticked items into `wiki-inbox.archive.md`? SRS §15(3).
- **OQ-4** — Surface "last lint was N days ago" hint in `/wiki-status`? SRS §15(4).
- **OQ-5** — Should `SCHEMA.md` patches diff-render in lint widget? SRS §15(5).
