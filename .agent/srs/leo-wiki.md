# Leo — Wiki (SRS)

Companion to `srs.md`, `architecture.md`, and `external-agent.md`. Specifies the Wiki feature: a vault-local, LLM-maintained knowledge base under a fixed `wiki/` folder, ingested via dedicated LangGraph subgraphs, retrieved via a dedicated tool, and excluded from RAG.

This SRS is the contract. Every requirement (`FR-WIKI-*` / `NFR-WIKI-*`) maps to at least one module in §11.

---

## 1. Purpose & Scope

### 1.1 Purpose

Give Leo a separate retrieval surface for _knowledge_ — curated, structured, interlinked — distinct from the _lifestream_ surface (personal notes, plans, journals) handled by RAG. The wiki:

- lives in a fixed vault folder `wiki/` with a fixed inbox file `wiki-inbox.md`;
- is excluded from RAG by default and indefinitely;
- is populated and maintained exclusively by LLM subgraphs (ingest, lint), never by ad-hoc main-agent edits;
- is queried by the main agent through a dedicated `search_wiki` tool that reads `wiki/index.md` first;
- compounds over time via the wiki pattern described in `.agent/srs/wiki.md` (raw sources → per-source summaries → entity/concept pages → maintained index + log).

The feature targets local small LLMs (Qwen3 30B-class and smaller). Multi-source ingestion and multi-page maintenance are decomposed into bounded subagent calls (extract, reduce) so that no single prompt has to coordinate the whole job.

### 1.2 In Scope (v1)

- Bootstrap of the fixed wiki folder layout on plugin load.
- `wiki-inbox.md` parser and batch ingest path.
- Built-in trigger tools: `delegate_wiki_ingest`, `delegate_wiki_lint`, `inbox_add`, `search_wiki`.
- Ingest subgraph (PREPARING → FETCHING → PERSISTING → PLANNING → EXTRACTING → REDUCING → WRITING → DONE/CANCELLED/ERROR).
- Lint subgraph (SCANNING → CHECKING → PROPOSING → CONFIRMING → WRITING → DONE/CANCELLED/ERROR).
- Map-reduce subagent roles: extractor (per source), reducer (per affected page).
- Re-ingest detection via SHA-256 stored in raw-file frontmatter; user resolves conflicts (skip / re-process / replace).
- Live widget mirroring `ExternalAgentLiveBlock` and terminal snapshot mirroring `ExternalAgentTerminalBlock`.
- Vault-global wiki mutex (one ingest _or_ lint at a time, across threads).
- Embedded seed content for `introduction.md` and `SCHEMA.md`, written once on first run only.
- Auto-add of `wiki/` to the RAG exclude list.

### 1.3 Out of Scope (v1)

- Image and PDF ingestion (text sources only).
- Wiki-specific vector or BM25 search engine. `index.md`-first retrieval is sufficient at v1 scale.
- Auto-ingest on `wiki-inbox.md` write. Explicit user trigger only.
- Configurable folder name, inbox name, or per-vault enablement toggle. Names are fixed; folder is always created.
- Cross-vault wiki sharing.
- Resuming an in-flight ingest or lint subgraph across plugin reloads.
- Git-commit-per-ingest atomicity. v1 relies on `log.md` plus best-effort writes.
- Auto-attaching produced wiki pages to the next user turn.

---

## 2. Glossary

| Term                   | Meaning                                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Wiki**               | The knowledge-base layer. Fixed root: `wiki/`.                                                                                    |
| **Lifestream**         | The non-wiki vault content. Indexed by RAG.                                                                                       |
| **Inbox**              | `wiki-inbox.md` at vault root. Markdown checklist of pending ingest items.                                                        |
| **Raw entry**          | A file under `wiki/raw/` holding the original ingested content, immutable post-write.                                             |
| **Source summary**     | A file under `wiki/sources/` with key facts + citations + 1:1 link to a raw entry.                                                |
| **Page**               | A file under `wiki/pages/` describing one entity, concept, or topic.                                                              |
| **Schema**             | `wiki/SCHEMA.md`. Conventions the agent follows when ingesting and linting. User-editable; agent may propose edits via lint.      |
| **Introduction**       | `wiki/introduction.md`. User-facing description of what the wiki is for.                                                          |
| **Index**              | `wiki/index.md`. Catalog of all pages with one-line summaries, organized by category.                                             |
| **Log**                | `wiki/log.md`. Append-only chronological record of wiki operations.                                                               |
| **Ingest subgraph**    | LangGraph subgraph under `src/agent/wiki/ingest/`. Reads sources → updates pages.                                                 |
| **Lint subgraph**      | LangGraph subgraph under `src/agent/wiki/lint/`. Audits + proposes patches.                                                       |
| **Extractor subagent** | LLM call inside ingest, scoped per raw entry. Returns structured page-op proposals.                                               |
| **Reducer subagent**   | LLM call inside ingest, scoped per affected page. Merges all extractor proposals targeting that page into one coherent edit.      |
| **Wiki mutex**         | Vault-global advisory lock guarding ingest + lint. One holder at a time.                                                          |
| **Run handle**         | The runtime object returned when a subgraph starts; carries `runId`, abort, terminal promise. Mirrors external-agent `RunHandle`. |
| **Live widget**        | Inline assistant block rendering current subgraph state, registered under the wiki live-kind.                                     |
| **Terminal snapshot**  | Persisted, post-terminal block payload for the live widget. Re-renders into a collapsed summary on thread reopen.                 |

---

## 3. Functional Requirements

### 3.1 Bootstrap & Layout

| ID             | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FR-WIKI-01** | On plugin load, ensure the following paths exist: `wiki/`, `wiki/raw/`, `wiki/sources/`, `wiki/pages/`, `wiki-inbox.md`. Creation is idempotent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **FR-WIKI-02** | On first run only, seed `wiki/introduction.md`, `wiki/SCHEMA.md`, `wiki/index.md` (empty catalog), and `wiki/log.md` (empty) from embedded constants. Existing files are never overwritten.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **FR-WIKI-03** | `introduction.md` describes purpose, what belongs in wiki vs lifestream, how to add sources, the folder map, and **the agent–user authoring policy: the agent owns `pages/`, `sources/`, and `index.md`, and may overwrite them during ingest/lint, but reducer prompts instruct it to preserve user-authored content where compatible with `SCHEMA.md`. Lint flags structural drift (unsourced claims, schema deviations) as `info`-severity findings rather than auto-rewriting them — destructive actions always require user confirmation in the lint widget.** Content is fixed in code (`src/agent/wiki/seed/introduction.ts`) but the on-disk copy is user-editable after seeding.                                         |
| **FR-WIKI-04** | `SCHEMA.md` describes: page naming (kebab-case, one entity per page); cross-reference format (Obsidian wikilinks `[[pages/<slug>]]`); citation format (`[[sources/<slug>]]` in body, vault-relative path-without-`.md` in structured fields per §8.1, §8.2); page structure (H1 canonical name, optional aliases, body, sources section); **page frontmatter conventions for Dataview compatibility — `tags: string[]`, `last_updated: <iso8601>`, `source_count: number`, optional domain-specific fields**; source-summary frontmatter (`source_url`, `fetched_at`, `sha256`, `raw_path`); and index-entry conventions (one line per page under category headings). Seeded from `src/agent/wiki/seed/schema.ts`. User-editable. |
| **FR-WIKI-05** | On plugin load, ensure `wiki/` is present in the RAG exclude list (`excludeListStore`). Idempotent. The `dirtyQueue` filters `wiki/` at intake so wiki content never enters the indexer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **FR-WIKI-06** | `wiki/` and `wiki-inbox.md` names are fixed and not user-configurable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### 3.2 Inbox

| ID             | Requirement                                                                                                                                                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FR-WIKI-07** | `wiki-inbox.md` is a markdown file containing a checklist of ingest items. Format per line: `- [ ] <ref>  <!-- optional note -->` where `<ref>` is an absolute URL or a vault-relative path. Lines that do not match the pattern are ignored by the parser. |
| **FR-WIKI-08** | The `inbox_add(ref, note?)` tool appends a single `- [ ] <ref>  <!-- <note> -->` line to `wiki-inbox.md`. The tool is read-only with respect to wiki content (it only edits the inbox file) and does not require confirmation.                              |
| **FR-WIKI-09** | After successful ingest of an item, the parser ticks the corresponding line to `- [x] <ref>` in place. On failure, the line remains unchecked and is annotated inline as `- [ ] <ref>  <!-- error: <code>: <msg> -->`.                                      |
| **FR-WIKI-10** | Inbox processing is single-flight per item, sequential (concurrency 1). The user explicitly invokes processing via `delegate_wiki_ingest({ source: 'inbox' })`. There is no auto-ingest on file-modify events.                                              |

### 3.3 Routing & Wiki Search

| ID             | Requirement                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FR-WIKI-11** | A built-in tool `search_wiki(query, opts?)` is registered in `ToolRegistry` at plugin load. It is read-only and does not require confirmation.                                                                                                                                                                                                                                                                 |
| **FR-WIKI-12** | `search_wiki` reads `wiki/index.md` first, picks up to N candidate pages by lexical/heuristic match (default N=8), reads matched page bodies, and returns `{ matches: [{ path, summary, snippet }], indexConsulted: true }`. The tool never reads `raw/`.                                                                                                                                                      |
| **FR-WIKI-13** | The main agent's always-on system prompt segment (`LEO_PREAMBLE`) is extended with a routing rule: _knowledge / facts / concepts / entities / research → prefer `search_wiki`; personal / journal / activity → prefer `search_vault`; if `search_wiki` returns no matches and the query smells factual, fall back to `search_vault`_. The wording is implementation-tunable and lives in `src/agent/types.ts`. |
| **FR-WIKI-14** | When a wiki ingest or lint is in progress, `search_wiki` still serves reads. The first line of its result includes a notice: `"warning: wiki <op> in progress (runId=<id>) — results may be partial"`. The notice is also surfaced to the UI as a transient `Notice` toast at most once per minute per thread.                                                                                                 |

### 3.4 Ingest Trigger & Confirmation

| ID             | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FR-WIKI-15** | A built-in tool `delegate_wiki_ingest(input)` is registered in `ToolRegistry` at plugin load. Its description instructs the main agent to use it when the user asks to ingest a URL, file, or inbox batch, **or to file an answer/analysis from the current conversation back into the wiki as a new page** (compounding the wiki from exploration, not just from sources).                                                                                                                                                                             |
| **FR-WIKI-16** | `delegate_wiki_ingest` declares `requiresConfirmation: true`. Confirmation surface is the existing `confirmationController` inline prompt with two actions: **Prepare wiki ingest** and **Deny**.                                                                                                                                                                                                                                                                                                                                                       |
| **FR-WIKI-17** | `input` is one of: `{ kind: 'url', url: string, note?: string }`, `{ kind: 'vaultPath', path: string, note?: string }`, `{ kind: 'attachment', attachmentId: string, note?: string }`, `{ kind: 'inbox' }`, `{ kind: 'conversation', title: string, body: string, citedSources?: string[], note?: string }`. The `conversation` kind skips FETCHING (the body is the source content) but still runs PERSISTING (raw entry written with `source: 'conversation:<threadId>:<turnIndex>'`, sha256 over body), PLANNING, EXTRACTING, REDUCING, and WRITING. |
| **FR-WIKI-18** | Deny → tool returns `{ ok: false, denied: true }`. The main agent receives this as a tool result and continues normally.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **FR-WIKI-19** | Prepare → the ingest subgraph mounts an inline widget block (assistant-side message) and the tool call enters a **suspended** state until the subgraph completes.                                                                                                                                                                                                                                                                                                                                                                                       |

### 3.5 Lint Trigger & Confirmation

| ID             | Requirement                                                                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FR-WIKI-20** | A built-in tool `delegate_wiki_lint(scope?)` is registered in `ToolRegistry`. `scope` is one of `{ kind: 'all' }`, `{ kind: 'pages', glob: string }`, or `{ kind: 'orphans' }` (default `all`). |
| **FR-WIKI-21** | `delegate_wiki_lint` declares `requiresConfirmation: true`. Confirmation actions: **Run wiki lint** and **Deny**.                                                                               |
| **FR-WIKI-22** | On Prepare, the lint subgraph mounts an inline widget block and the tool call suspends until terminal.                                                                                          |

### 3.6 Vault-Global Wiki Mutex

| ID             | Requirement                                                                                                                                                                                                                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FR-WIKI-23** | At most one ingest **or** lint subgraph may be active across the entire vault (all threads). The mutex is held in plugin-process memory in `WikiMutex` and released on terminal state.                                                                                                                                                       |
| **FR-WIKI-24** | A second `delegate_wiki_ingest` or `delegate_wiki_lint` invocation while the mutex is held returns immediately with `{ ok: false, error: 'busy', activeRunId, activeOp: 'ingest' \| 'lint' }`. The widget is **not** mounted. The main agent surfaces a user-visible message (e.g. "Wiki is busy with run X — try again when it finishes."). |
| **FR-WIKI-25** | The mutex is released in a `try/finally` wrapping the entire subgraph driver. Exceptions, aborts, and timeouts all release.                                                                                                                                                                                                                  |

### 3.7 Ingest Subgraph — Phases

| ID             | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FR-WIKI-26** | Phase **PREPARING**: a refine sub-agent (analogous to external-agent's refine) clarifies scope when ambiguous. It may emit at most three clarifying questions (configurable via the widget). Allowed actions: `ask_clarifying_question`, `emit_ingest_plan`. The refine sub-agent has no vault tools.                                                                                                                                                                                                                               |
| **FR-WIKI-27** | Phase **FETCHING**: per source — URL → markdown via the existing inline-agent `fetch_url` + sanitize chain (`src/agent/externalAgent/adapters/inlineAgent/tools/`); vault path → read via `VaultAdapter`; attachment → read from the chat attachment store. Failures are recorded and the source moves to terminal `error` state without aborting the whole batch.                                                                                                                                                                  |
| **FR-WIKI-28** | Phase **PERSISTING**: each fetched source is written to `wiki/raw/<YYYYMMDD>-<slug>.md` with frontmatter `{ source: <ref>, fetched_at: <iso8601>, content_type: <mime>, sha256: <hex>, original_path?: <vault-path> }`. The body is the fetched markdown verbatim. Raw files are never modified after this phase.                                                                                                                                                                                                                   |
| **FR-WIKI-29** | Phase **PLANNING**: a single LLM call reads `SCHEMA.md`, the truncated `index.md` (top N=200 lines), and per-source frontmatter + first M=2000 chars. It outputs a JSON plan: `{ ingestId, perSource: [{ rawPath, candidatePages: string[] }] }`. Validated against a Zod schema.                                                                                                                                                                                                                                                   |
| **FR-WIKI-30** | Phase **EXTRACTING**: extractor subagents fan out per raw entry, bounded by `extractorConcurrency` (default 1, max 2). Inputs: raw file content (truncated to `extractorInputCap` tokens, default 8000), `SCHEMA.md`, the candidate-page list from the plan, and matching index excerpts. Output is JSON validated against `ExtractorOutput` (§8.1) and capped at `extractorOutputCap` tokens (default 1500). On parse failure: one retry with the parser error appended; second failure marks the source `error: extract_invalid`. |
| **FR-WIKI-31** | Phase **REDUCING**: reducer subagents fan out per affected page (a page is "affected" if any extractor proposed an op against it), bounded by `reducerConcurrency` (default 1). Input: current page content (or empty for `create`), all `page_ops` targeting it, plus `SCHEMA.md`. Output: a single coherent page body (Zod-validated `ReducerOutput`, §8.2). On parse failure: one retry; second failure marks the page `error: reduce_invalid` and leaves it untouched.                                                          |
| **FR-WIKI-32** | Phase **WRITING**: the wiki writer applies reducer outputs in deterministic order — page creates first, then page edits, then `sources/` summaries (one per ingested raw entry), then `index.md` update, then a `log.md` append-entry. Each file write is atomic per-file via `VaultAdapter`. Mid-phase failure leaves prior writes in place; the run continues but moves to terminal `error` after exhausting the batch.                                                                                                           |
| **FR-WIKI-33** | Phase **DONE**: the subgraph terminal state. The `delegate_wiki_ingest` tool resumes with result `{ ok: true, ingestId, sources: [{ rawPath, sourcePath, status }], pagesCreated: string[], pagesEdited: string[], durationMs }`.                                                                                                                                                                                                                                                                                                   |

### 3.8 Lint Subgraph — Phases

| ID             | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FR-WIKI-34** | Phase **SCANNING**: enumerate `pages/` and `sources/` only — these are the agent-owned, lint-eligible surfaces. Build wikilink adjacency, count inbound/outbound refs, identify orphan pages (zero inbound) and orphan raw entries (no `sources/` summary referencing them). Wiki root files are scoped explicitly: `index.md` is **regenerated** by every successful ingest WRITING phase (always reflects current `pages/`, never linted in place); `log.md` is **append-only** and never linted; `introduction.md` is **user-only** and never read or modified by lint; `SCHEMA.md` is read by every checker as input but only ever modified through the explicit schema-drift confirmation flow (FR-WIKI-37). |
| **FR-WIKI-35** | Phase **CHECKING**: checker subagents fan out per concern: contradictions across pages, stale claims (page references a `sources/` entry that has been replaced), missing pages (entities mentioned in `≥ K=3` pages but lacking their own page; K configurable), missing cross-refs, **research gaps (topics/entities with thin source coverage — surfaces suggested follow-up questions and source-search queries the user could investigate)**, and proposed `SCHEMA.md` edits. Each checker outputs a list of `LintFinding` (§8.3). Research-gap findings carry `severity: 'info'` and emit `patch: null` — they are advisory, never auto-applied.                                                            |
| **FR-WIKI-36** | Phase **PROPOSING**: the lint subgraph aggregates findings into a ranked patch list `{ page, action, rationale, patch }`. Schema-edit proposals are emitted as a separate `schemaPatch` field rather than inline page edits.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **FR-WIKI-37** | Phase **CONFIRMING**: findings are surfaced in the lint widget. The user accepts/rejects per item (multi-select). The widget exposes "Accept all", "Reject all", "Apply selected". Schema patches require explicit confirmation each time and never auto-apply.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **FR-WIKI-38** | Phase **WRITING**: accepted patches are applied via the same writer as ingest. Schema patches edit `SCHEMA.md`. A single `log.md` entry records the lint run with the count of accepted/rejected findings.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **FR-WIKI-39** | Phase **DONE**: tool resumes with `{ ok: true, lintId, findings: { total, accepted, rejected }, pagesEdited: string[], schemaEdited: boolean, durationMs }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### 3.9 Re-ingest Detection

| ID             | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FR-WIKI-40** | During PERSISTING, the SHA-256 of the fetched body is computed before write. If any existing file under `wiki/raw/` has a matching `sha256` in its frontmatter, the ingest pauses on that source via LangGraph `interrupt()` and surfaces a per-source choice in the widget: **Skip** (do nothing, mark `status: 'skipped-duplicate'`), **Re-process** (re-run extract+reduce against the existing raw entry, no new raw write), **Replace** (overwrite the existing raw file with the new fetch and continue). |
| **FR-WIKI-41** | If the user does not respond within `reingestPromptTimeoutMs` (default 60s), the source defaults to **Skip** and the run continues.                                                                                                                                                                                                                                                                                                                                                                             |

### 3.10 Cancellation

| ID             | Requirement                                                                                                                                                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **FR-WIKI-42** | Both subgraphs accept an `AbortSignal` threaded through `LLM.stream({ signal })` and tool calls. Cancel during PREPARING/PLANNING/EXTRACTING/REDUCING/CHECKING/PROPOSING transitions to `CANCELLED` within ≤ 2 s wall-clock and discards in-flight outputs. |
| **FR-WIKI-43** | Cancel during WRITING **completes the in-flight per-file write** before transitioning to `CANCELLED`, so no partial file is left on disk. The remaining queued writes are skipped and the run logs `## [<iso>] cancelled-mid-write                          | <runId>`to`log.md`. |
| **FR-WIKI-44** | On cancel, the tool returns `{ ok: false, cancelled: true, phase: <last-phase>, partial: { pagesCreated, pagesEdited, sourcesPersisted } }`.                                                                                                                |

### 3.11 Error Handling

| ID             | Requirement                                                                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------- |
| **FR-WIKI-45** | An unhandled throw in any subgraph node, an extractor/reducer parse failure exhausting retry, or a fetch failure on every batch source transitions the subgraph to `ERROR`.       |
| **FR-WIKI-46** | On `ERROR`, the writer best-effort-writes a `log.md` entry `## [<iso>] error                                                                                                      | <runId> | <code>: <msg>`and the tool returns`{ ok: false, error: { code, message }, partial }`. |
| **FR-WIKI-47** | Errors do **not** roll back successfully written pages or raw entries. Cleanup is the user's responsibility, surfaced via the next `/wiki-lint` run (orphan raw entries flagged). |

### 3.12 Widget Lifecycle

| ID             | Requirement                                                                                                                                                                                                                                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FR-WIKI-48** | Each ingest or lint run mounts an inline assistant message block. The block is rendered live by an `WikiLiveBlock` component (mirrors `ExternalAgentLiveBlock`). It looks up the live controller via a `wikiLiveControllerRegistry` keyed by `runId`.                                                                                          |
| **FR-WIKI-49** | Live widget surfaces, by phase: refining transcript + clarification input (PREPARING), per-source fetch progress + duplicate prompts (FETCHING/PERSISTING), plan summary (PLANNING), per-source extractor progress (EXTRACTING), per-page reducer progress (REDUCING), per-file write progress (WRITING), confirmation list (lint CONFIRMING). |
| **FR-WIKI-50** | After a terminal state, the live controller emits a `WikiTerminalSnapshot` that replaces the live block with a `WikiTerminalBlock` (mirrors `ExternalAgentTerminalBlock`): collapsed one-line summary expandable to show full per-phase counts, per-source statuses, error message if any, and the `log.md` line written by this run.          |
| **FR-WIKI-51** | On thread reopen after plugin reload, the persisted terminal snapshot re-renders. The live block, if any was active at reload, rehydrates to `error.code = 'reload'` (mirrors NFR-EXT-04).                                                                                                                                                     |

### 3.13 Slash Commands

| ID             | Requirement                                                                                                                                                                                                                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FR-WIKI-52** | The composer registers three slash commands: `/wiki-ingest`, `/wiki-lint`, `/wiki-status`. Each invokes the corresponding tool with default args. `/wiki-status` is read-only and prints index size, last lint timestamp (read from `log.md`), orphan count (computed live), and current mutex state. |

---

## 4. Non-Functional Requirements

| ID              | Requirement                                                                                                                                                                                                                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **NFR-WIKI-01** | Cancel surfaces within ≤ 2 s wall-clock from button press to subgraph terminal state. Adapters / tools must respect the `AbortSignal`.                                                                                                                                                                                                                      |
| **NFR-WIKI-02** | Subgraph state is in-memory only. A plugin reload during a non-terminal phase discards the run; the live block rehydrates to `error.code = 'reload'`.                                                                                                                                                                                                       |
| **NFR-WIKI-03** | Logging: every state transition + per-source/per-page event logged at `debug` under namespaces `wiki.ingest.*` and `wiki.lint.*`. Errors at `error`. Raw source content and extractor outputs are **not** logged above `debug`.                                                                                                                             |
| **NFR-WIKI-04** | Bundle: wiki feature (subgraphs + tools + widgets + seeds + writer + mutex) adds ≤ 40 KB minified to `main.js`. No new top-level dependency. SHA-256 uses the existing Web Crypto path.                                                                                                                                                                     |
| **NFR-WIKI-05** | All subgraph nodes that touch IO are wrapped in `try/finally` to guarantee abort cleanup. The wiki mutex is released in the outermost `finally`.                                                                                                                                                                                                            |
| **NFR-WIKI-06** | Both subgraphs are unit-testable end-to-end with a mock LLM (canned `AsyncIterable` of responses) and a fake `VaultAdapter` — no msw or real provider required for state-machine and writer tests.                                                                                                                                                          |
| **NFR-WIKI-07** | Extractor and reducer LLM outputs are Zod-validated. Schema violations surface as a single retry with the parser error injected as a tool message; a second failure marks the source/page errored without crashing the run.                                                                                                                                 |
| **NFR-WIKI-08** | Concurrency caps (`extractorConcurrency`, `reducerConcurrency`) are enforced via an explicit semaphore module; never via ad-hoc `Promise.all` chains.                                                                                                                                                                                                       |
| **NFR-WIKI-09** | The wiki feature must operate correctly on a vault where `wiki/` is a symlink, an Obsidian-synced folder, or a fresh empty directory. No filesystem-specific behavior is assumed beyond what `VaultAdapter` already abstracts.                                                                                                                              |
| **NFR-WIKI-10** | Token budgets per LLM call are explicit constants exported from `src/agent/wiki/budgets.ts`: `extractorInputCap = 8000`, `extractorOutputCap = 1500`, `reducerInputCap = 6000`, `reducerOutputCap = 2000`, `plannerInputCap = 4000`, `plannerOutputCap = 1500`, `checkerInputCap = 6000`, `checkerOutputCap = 1500`. Tunable in code, not in user settings. |

---

## 5. State Machines

### 5.1 Ingest

```
                       Deny
                        ▲
                        │
   delegate_wiki_ingest ──►(confirm)──Prepare──► PREPARING ──┐
                                                  │          │
                                                  │ optional │
                                                  ▼          │
                                       clarification(s) via  │
                                       LangGraph interrupt() │
                                                  │          │
                                                  ▼          │
                                              FETCHING ──────┤
                                                  │          │
                                                  ▼          │
                                             PERSISTING ─────┤
                                                  │          │
                                       (duplicate-detect) ◄──┤
                                                  │          │
                                                  ▼          │
                                              PLANNING ──────┤
                                                  │          │
                                                  ▼          │
                                            EXTRACTING ──────┤
                                                  │          │
                                                  ▼          │
                                             REDUCING ───────┤
                                                  │          │
                                                  ▼          │
                                              WRITING ───────┤
                                                  │          │
                              ┌───── Cancel ◄────┴────► error/throw
                              ▼                                │
                          CANCELLED                            ▼
                                                             ERROR
                                                  ▼
                                                 DONE
```

### 5.2 Lint

```
   delegate_wiki_lint ──►(confirm)──Prepare──► SCANNING ─► CHECKING ─► PROPOSING ─► CONFIRMING ─► WRITING ─► DONE
                                                  │           │            │            │            │
                                                  └─ Cancel ──┴── Cancel ──┴── Cancel ──┴── Cancel ──┴── Cancel ──► CANCELLED
                                                                                                       │
                                                                                                  error/throw
                                                                                                       ▼
                                                                                                    ERROR
```

Terminal states for both: `DONE`, `CANCELLED`, `ERROR`. The originating tool resumes with the corresponding result object on entry to a terminal state.

---

## 6. Subgraph State Shapes

```ts
// src/agent/wiki/ingest/state.ts
import { z } from 'zod';
import type { BaseMessage } from '@langchain/core/messages';

export type IngestPhase =
  | 'preparing'
  | 'fetching'
  | 'persisting'
  | 'planning'
  | 'extracting'
  | 'reducing'
  | 'writing'
  | 'done'
  | 'cancelled'
  | 'error';

export interface SourceItem {
  readonly ref: string; // url | vault path | attachmentId
  readonly kind: 'url' | 'vaultPath' | 'attachment' | 'inbox';
  readonly note?: string;
  fetchedBody: string | null;
  contentType: string | null;
  sha256: string | null;
  rawPath: string | null; // wiki/raw/<...>.md
  duplicate?: { existingRawPath: string; resolution: 'skip' | 'reprocess' | 'replace' };
  status:
    | 'pending'
    | 'fetched'
    | 'persisted'
    | 'extracted'
    | 'reduced'
    | 'done'
    | 'skipped-duplicate'
    | 'error';
  errorCode?: string;
  errorMessage?: string;
}

export interface IngestState {
  runId: string;
  threadId: string;
  phase: IngestPhase;

  refineHistory: readonly BaseMessage[];
  refineIterations: number;
  refineBudget: number;

  sources: readonly SourceItem[];
  plan: { perSource: readonly { rawPath: string; candidatePages: readonly string[] }[] } | null;

  extractorOutputs: ReadonlyMap<string /* rawPath */, ExtractorOutput>;
  affectedPages: ReadonlyMap<string /* pagePath */, ReadonlyArray<{ rawPath: string; op: PageOp }>>;
  reducerOutputs: ReadonlyMap<string /* pagePath */, ReducerOutput>;

  startedAt: number;
  endedAt: number | null;
  pagesCreated: readonly string[];
  pagesEdited: readonly string[];
  sourcesPersisted: readonly string[];

  error: { code: string; message: string } | null;
}
```

```ts
// src/agent/wiki/lint/state.ts
export type LintPhase =
  | 'scanning'
  | 'checking'
  | 'proposing'
  | 'confirming'
  | 'writing'
  | 'done'
  | 'cancelled'
  | 'error';

export interface LintState {
  runId: string;
  threadId: string;
  phase: LintPhase;
  scope: { kind: 'all' } | { kind: 'pages'; glob: string } | { kind: 'orphans' };

  adjacency: ReadonlyMap<string, ReadonlySet<string>> | null;
  findings: readonly LintFinding[];
  proposedPatches: readonly LintPatch[];
  schemaPatch: LintSchemaPatch | null;
  acceptedPatchIds: readonly string[];

  startedAt: number;
  endedAt: number | null;
  pagesEdited: readonly string[];
  schemaEdited: boolean;

  error: { code: string; message: string } | null;
}
```

State is the single source of truth for the live widget. The widget controller projects the state into UI; no parallel store.

---

## 7. Module Map

```
src/agent/wiki/
├── seed/
│   ├── introduction.ts             # embedded introduction.md content
│   └── schema.ts                    # embedded SCHEMA.md content
├── bootstrap.ts                     # ensure dirs/files; idempotent; runs in main.ts onload
├── budgets.ts                       # exported token caps (NFR-WIKI-10)
├── mutex.ts                         # WikiMutex (vault-global) + acquire/release
├── runIdRegistry.ts                 # generateWikiRunId() — YYYYMMDD-HHmmss-<6char>
├── liveControllerRegistry.ts        # Map<runId, WikiWidgetController>
├── inbox/
│   ├── parse.ts                     # parse + tick + annotate-error
│   └── inboxAddTool.ts              # inbox_add tool
├── search/
│   ├── searchWikiTool.ts            # search_wiki tool
│   └── indexReader.ts               # parse index.md, lexical match
├── ingest/
│   ├── state.ts                     # IngestState, ExtractorOutput, ReducerOutput, PageOp (Zod)
│   ├── refine.ts                    # refine sub-agent (analogous to externalAgent/refineSubAgent.ts)
│   ├── refinePrompt.ts              # core-owned refine system prompt
│   ├── fetch.ts                     # URL/vault/attachment fetch + sanitize
│   ├── persist.ts                   # SHA-256 + frontmatter + duplicate detection
│   ├── plan.ts                      # planner subagent
│   ├── extract.ts                   # extractor subagent
│   ├── reduce.ts                    # reducer subagent
│   ├── write.ts                     # writer (pages → sources → index → log)
│   ├── subgraph.ts                  # FSM driver, AbortSignal, mutex acquire/release
│   ├── orchestrator.ts              # WikiIngestOrchestrator.start({...}) → RunHandle
│   └── delegateIngestTool.ts        # delegate_wiki_ingest tool
├── lint/
│   ├── state.ts                     # LintState, LintFinding, LintPatch, LintSchemaPatch (Zod)
│   ├── scan.ts                      # adjacency build + orphan detection
│   ├── check.ts                     # checker subagents (per concern type)
│   ├── propose.ts                   # aggregate + rank
│   ├── write.ts                     # apply accepted patches
│   ├── subgraph.ts                  # FSM driver
│   ├── orchestrator.ts              # WikiLintOrchestrator.start({...}) → RunHandle
│   └── delegateLintTool.ts          # delegate_wiki_lint tool
├── widget/
│   ├── widgetController.ts          # WikiWidgetController (live)
│   ├── terminalSnapshot.ts          # WikiTerminalSnapshot Zod + buildTerminalSnapshot
│   ├── WikiLiveBlock.tsx            # registered under WIKI_LIVE_KIND
│   └── WikiTerminalBlock.tsx        # registered under WIKI_TERMINAL_KIND
└── loggingNamespaces.ts             # 'wiki.ingest.*', 'wiki.lint.*', 'wiki.search.*'
```

---

## 8. Tool & Subagent Contracts

### 8.1 Extractor Output (Zod)

```ts
export const PageOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('create'), page: z.string(), reason: z.string(), fragment: z.string() }),
  z.object({ op: z.literal('append'), page: z.string(), reason: z.string(), fragment: z.string() }),
  z.object({
    op: z.literal('patch'),
    page: z.string(),
    reason: z.string(),
    find: z.string(),
    replace: z.string(),
  }),
]);

export const ExtractorOutput = z.object({
  schemaVersion: z.literal(1),
  rawPath: z.string(),
  entities: z.array(z.string()).max(50),
  claims: z
    .array(
      z.object({
        text: z.string(),
        citations: z.array(z.string()).min(1), // vault-relative paths to sources/, no `.md` suffix, e.g. "sources/2026-04-29-foo"
      }),
    )
    .max(50),
  pageOps: z.array(PageOp).max(20),
  sourceSummary: z.string().max(4000), // body of sources/<slug>.md (rendered with [[sources/<slug>]] wikilinks)
});
export type ExtractorOutput = z.infer<typeof ExtractorOutput>;
```

### 8.2 Reducer Output (Zod)

```ts
export const ReducerOutput = z.object({
  schemaVersion: z.literal(1),
  page: z.string(),
  body: z.string(), // full page body, agent-maintained, contains [[sources/<slug>]] wikilinks
  citedSources: z.array(z.string()).max(50), // vault-relative paths to sources/, no `.md` suffix; structured mirror of in-body wikilinks
});
export type ReducerOutput = z.infer<typeof ReducerOutput>;
```

### 8.3 Lint Finding & Patch (Zod)

```ts
export const LintFinding = z.object({
  id: z.string(),
  kind: z.enum([
    'contradiction',
    'stale',
    'orphan-page',
    'orphan-raw',
    'missing-page',
    'missing-xref',
    'research-gap', // advisory: topic with thin source coverage; carries suggestedQueries
    'schema-drift',
  ]),
  severity: z.enum(['info', 'warn', 'error']),
  page: z.string().optional(),
  rationale: z.string().max(2000),
  suggestedQueries: z.array(z.string()).max(10).optional(), // populated when kind === 'research-gap'
});

export const LintPatch = z.object({
  id: z.string(), // matches a LintFinding.id
  page: z.string(),
  action: z.enum(['edit', 'create', 'delete']),
  body: z.string().optional(), // for edit/create
  reason: z.string().max(2000),
});

export const LintSchemaPatch = z.object({
  body: z.string(), // full new SCHEMA.md
  diffSummary: z.string().max(2000),
  rationale: z.string().max(2000),
});
```

### 8.4 search_wiki Result

```ts
export const SearchWikiResult = z.object({
  indexConsulted: z.literal(true),
  matches: z
    .array(
      z.object({
        path: z.string(), // wiki/pages/<slug>.md
        summary: z.string(),
        snippet: z.string(),
        score: z.number(),
      }),
    )
    .max(8),
  warning: z.string().optional(), // FR-WIKI-14 in-progress notice
});
```

---

## 9. Storage Layout

```
<vault>/
├── wiki/
│   ├── introduction.md              # seeded once; user-editable
│   ├── SCHEMA.md                    # seeded once; user-editable; agent may propose edits via lint
│   ├── index.md                     # agent-maintained catalog
│   ├── log.md                       # append-only operations record
│   ├── raw/
│   │   └── <YYYYMMDD>-<slug>.md     # immutable; frontmatter = {source, fetched_at, content_type, sha256, original_path?}
│   ├── sources/
│   │   └── <slug>.md                # 1:1 with raw entry; frontmatter cites raw_path
│   └── pages/
│       └── <kebab-name>.md          # entity/concept/topic page
└── wiki-inbox.md                    # `- [ ] <ref>  <!-- note? -->`
```

`index.md` format (excerpt):

```markdown
# Wiki Index

## Concepts

- [[pages/retrieval-augmented-generation]] — combining LLMs with external retrieval

## Entities

- [[pages/leo-plugin]] — Obsidian-native local-first AI assistant

## Sources

- [[sources/2026-04-28-rag-survey]] — RAG Survey (Karpukhin et al.)
```

`log.md` format:

```markdown
## [2026-04-28T10:14:33Z] ingest | runId=20260428-101433-ab12cd

- 3 sources persisted, 2 pages created, 5 pages edited

## [2026-04-28T11:02:01Z] lint | runId=20260428-110201-ef45gh

- 12 findings, 9 accepted, 3 rejected
```

---

## 10. Settings

The wiki feature has **no user-configurable settings in v1**. All thresholds and concurrency caps live in `src/agent/wiki/budgets.ts` and require a code change to tune. A future toggle to disable the feature globally is out of scope.

The Settings tab gains no new section.

---

## 11. Module-to-Requirement Map

| Module                                                       | Requirements                                             |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| `bootstrap.ts`                                               | FR-WIKI-01..06                                           |
| `seed/introduction.ts`, `seed/schema.ts`                     | FR-WIKI-02..04                                           |
| `inbox/parse.ts`, `inbox/inboxAddTool.ts`                    | FR-WIKI-07..10                                           |
| `search/searchWikiTool.ts`, `search/indexReader.ts`          | FR-WIKI-11..14                                           |
| `ingest/delegateIngestTool.ts`, `ingest/orchestrator.ts`     | FR-WIKI-15..19, FR-WIKI-23..25                           |
| `lint/delegateLintTool.ts`, `lint/orchestrator.ts`           | FR-WIKI-20..22, FR-WIKI-23..25                           |
| `mutex.ts`                                                   | FR-WIKI-23..25, NFR-WIKI-05                              |
| `ingest/refine.ts`, `ingest/refinePrompt.ts`                 | FR-WIKI-26                                               |
| `ingest/fetch.ts`                                            | FR-WIKI-27                                               |
| `ingest/persist.ts`                                          | FR-WIKI-28, FR-WIKI-40..41                               |
| `ingest/plan.ts`                                             | FR-WIKI-29                                               |
| `ingest/extract.ts`                                          | FR-WIKI-30, NFR-WIKI-07..08, NFR-WIKI-10                 |
| `ingest/reduce.ts`                                           | FR-WIKI-31, NFR-WIKI-07..08, NFR-WIKI-10                 |
| `ingest/write.ts`                                            | FR-WIKI-32                                               |
| `ingest/subgraph.ts`                                         | FR-WIKI-33, FR-WIKI-42..47, NFR-WIKI-01..02, NFR-WIKI-05 |
| `lint/scan.ts`                                               | FR-WIKI-34                                               |
| `lint/check.ts`                                              | FR-WIKI-35, NFR-WIKI-07, NFR-WIKI-10                     |
| `lint/propose.ts`                                            | FR-WIKI-36                                               |
| `lint/write.ts`                                              | FR-WIKI-38                                               |
| `lint/subgraph.ts`                                           | FR-WIKI-37, FR-WIKI-39, FR-WIKI-42..47                   |
| `widget/widgetController.ts`, `widget/WikiLiveBlock.tsx`     | FR-WIKI-48..51                                           |
| `widget/terminalSnapshot.ts`, `widget/WikiTerminalBlock.tsx` | FR-WIKI-50..51                                           |
| `liveControllerRegistry.ts`                                  | FR-WIKI-48                                               |
| `slashCommands` (existing module)                            | FR-WIKI-52                                               |
| `loggingNamespaces.ts`                                       | NFR-WIKI-03                                              |
| `budgets.ts`                                                 | NFR-WIKI-10                                              |

---

## 12. Testing Strategy

| Layer                                                 | Coverage                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unit** (Vitest)                                     | `inbox/parse.ts` round-trip (parse → tick → annotate-error), `search/indexReader.ts` lexical match + warning injection, `persist.ts` SHA-256 + duplicate-detection, `mutex.ts` acquire/release/contention, `ingest/extract.ts` Zod retry-on-parse-failure, `ingest/reduce.ts` retry, `lint/scan.ts` adjacency build, `widget/terminalSnapshot.ts` schema round-trip, `budgets.ts` constants. |
| **Integration** (Vitest + canned LLM `AsyncIterable`) | Full ingest subgraph end-to-end with mock LLM and fake `VaultAdapter`, asserting per-phase state transitions, file writes, abort within 2s, mutex held → busy returned, duplicate-detect interrupt flow. Same for lint subgraph (scope=all, scope=pages glob, scope=orphans).                                                                                                                |
| **DOM** (Vitest + happy-dom)                          | `WikiLiveBlock` renders all phases from canned controller view-models; `WikiTerminalBlock` collapses/expands; controllers correctly route user actions (Send, Cancel, Accept-all, Skip/Reprocess/Replace duplicate).                                                                                                                                                                         |
| **Live** (`vitest.llm.config.ts`)                     | Real Qwen 30B against `tests/smoke/fixtures/tinyVault` extended with a `wiki/` setup. Three-source ingest, assert pages exist, `index.md` has entries, `log.md` has one entry, `sources/` has three files, `raw/` has three files with sha256 frontmatter. Lint pass on the resulting wiki, assert no findings.                                                                              |
| **Smoke**                                             | Manual checklist entry: bootstrap on empty vault creates wiki structure; ingest one URL; query main agent → `search_wiki` is selected; lint → no findings on a freshly-ingested wiki.                                                                                                                                                                                                        |

---

## 13. Phasing

| Phase                                | Scope                                                                                                                                                                             |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 1** — Bootstrap + Search     | `bootstrap.ts`, seeds, RAG exclude wiring, `search_wiki`, `inbox_add`, slash command `/wiki-status`. No subgraphs yet. Validates folder model + retrieval routing in isolation.   |
| **Phase 2** — Ingest (single source) | Full ingest subgraph, single-source mode only (`url`, `vaultPath`, `attachment`). Live + terminal widgets. Wiki mutex. `delegate_wiki_ingest` tool. Slash command `/wiki-ingest`. |
| **Phase 3** — Inbox batch            | `inbox/parse.ts` + `kind: 'inbox'` ingest path. Per-item duplicate-detect interrupt. Inbox tick/annotate writes.                                                                  |
| **Phase 4** — Lint                   | Full lint subgraph + scope variants + schema-edit proposals + confirmation UI. Slash command `/wiki-lint`.                                                                        |
| **Phase 5** — Hardening              | Token-budget tuning against real local-LLM runs, perf REPORT entry for ingest of 10/50/100 sources, extractor-cap tuning, lint perf on a 1000-page wiki fixture.                  |

Phase boundaries gate at the test matrix in §12: each phase ships unit + integration green for its scope.

---

## 14. Future Work (post-v1)

- Image/PDF source ingestion (text-extract preprocessor before persist).
- **Wiki-specific search engine (BM25 or `qmd` integration). Trigger threshold: `wiki/index.md` exceeds 50 KB, or `pages/` count exceeds 500, or `search_wiki` p95 latency over a representative query set exceeds 200 ms. Below those thresholds the index-first lexical match is the canonical retrieval path.**
- **Rich query output formats — comparison tables, Marp slide decks, matplotlib charts, Obsidian canvases — as alternative shapes for `search_wiki` answers. v1 returns only `{path, summary, snippet}` matches; the main agent renders synthesis as plain markdown. Post-v1, a query subgraph mirroring the ingest pattern can drive structured-output renderers and offer to file results back via `delegate_wiki_ingest({ kind: 'conversation' })`.**
- **Optional human-in-the-loop pause between EXTRACTING and REDUCING: surface extractor outputs (per-source key facts + proposed page ops) in the live widget, accept/edit/reject before reducers run. Trades latency for accuracy on small local LLMs. Gated behind a per-thread "review extracts" toggle in the widget.**
- Git-commit-per-ingest atomicity, gated on a setting once vault-as-git-repo detection is reliable.
- Cross-vault wiki sharing / sync.
- User-editable wiki settings (concurrency caps, token budgets) once defaults stabilize.
- A wiki "explorer" view (graph of pages, orphan list, lint preview) as a sidebar `ItemView`.
- Resume-on-reload for interrupted ingest runs (requires checkpoint persistence under `.leo/checkpoints/wiki/`).
- Auto-attach freshly-created wiki pages to the next user turn for verification.

---

## 15. Open Questions (tracked, not blocking)

1. Should `search_wiki` accept an optional `scope: 'pages' | 'sources' | 'all'` arg in v1? Defer until a query needs it.
2. Should the planner subagent be merged into the refine sub-agent for small models (one fewer LLM hop)? Measure on Qwen 30B in Phase 5.
3. Inbox failed-item cleanup: a `/wiki-inbox-clean` command that strips ticked items into a `wiki-inbox.archive.md`? Defer.
4. Lint cadence: surface a "last lint was N days ago" hint in `/wiki-status`? Probably yes; small UX win.
5. Schema-edit confirmation surface: should `SCHEMA.md` patches diff-render in the widget? Recommend yes from day one if the diff renderer is cheap to reuse.
