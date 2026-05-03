# Impl iteration 1 — F08 wiki-ingest-fetch-persist

## Summary
Stood up the FETCHING + PERSISTING + duplicate-detect path as composable pure-ish modules: `IngestSource` discriminated union, URL/vault/attachment/conversation fetchers (URL via inline-agent SSRF + sanitize chain), SHA-256 compute, raw frontmatter writer, duplicate-by-sha scan, default-to-Skip duplicate prompt, and a top-level `processSourceFetchPersist` orchestrator that returns a typed `SourceTerminalRecord` per source. No subgraph driver yet — F11 plugs this into the LangGraph FSM.

## Files touched
- `src/agent/wiki/ingest/types.ts` — `IngestSource`, `FetchedSource`, `FetchError`, `FetchResult`, `RawWritePayload`, `PersistedRaw`, `DuplicateChoice`, `DuplicateMatch`, `SourceTerminalRecord`.
- `src/agent/wiki/ingest/sha256.ts` — `computeSha256Hex(text)` via Web Crypto.
- `src/agent/wiki/ingest/slug.ts` — `slugifyLabel`, `dateStamp`, `buildRawPath` (`wiki/raw/<YYYYMMDD>-<slug>.md`).
- `src/agent/wiki/ingest/fetchSource.ts` — `fetchIngestSource(source, deps, signal)`. URL path runs SSRF resolveAndCheck + timeout + sanitizeBody; vault path via `VaultAdapter`; attachment via injected resolver; conversation passes body through unchanged; inbox kind explicitly errors (driven by F15).
- `src/agent/wiki/ingest/persistRaw.ts` — `persistRaw({fetched, slugLabel?, overwriteRawPath?}, deps)` writes raw with frontmatter `{source, fetched_at, content_type, sha256, original_path?}`; `computeFetchedSha256(fetched)` helper.
- `src/agent/wiki/ingest/duplicateDetect.ts` — `findDuplicateRawBySha(vault, sha256)` scans `wiki/raw/` frontmatter.
- `src/agent/wiki/ingest/duplicatePrompt.ts` — `resolveDuplicateChoice(match, {request, timeoutMs?, signal?})`; default-to-Skip after `WIKI_RUN_DEFAULTS.reingestPromptTimeoutMs` (60_000 ms); aborts → Skip.
- `src/agent/wiki/ingest/processSource.ts` — `processSourceFetchPersist(source, deps, signal)` returns `SourceTerminalRecord` with status one of `persisted | replaced | skipped | reprocessed | error`. Wraps fetch failure → `error` (per-source isolation), persist failure → `error`, dup branches → respective statuses.

## Tests added or updated
- `tests/unit/wikiIngestFetchPersist.test.ts` — 21 cases covering: SHA-256 determinism + 64-char hex; vault path read/missing; attachment resolver present/absent; URL invalid scheme, sanitize html, DNS-blocked private IP; persist writes frontmatter at `wiki/raw/YYYYMMDD-…` + overwrite path honoured; findDuplicateRawBySha matches/non-match; resolveDuplicateChoice default-to-Skip on timeout (FR-41), user choice forwarded, null → skip, signal abort → skip; processSourceFetchPersist per-source error isolation, persisted-on-fresh, skipped/replaced/reprocessed branches with no-overwrite/overwrite/no-overwrite semantics.

## Addressed gaps from previous iteration
Not applicable — first iteration.

## Deviations from feature.md
- F08 does not call LangGraph `interrupt()` directly; it accepts a `requestDuplicateChoice(match) => Promise<DuplicateChoice|null>` callback. F11's subgraph driver wires that callback to LangGraph `interrupt()` + the F06 widget controller. This is the only viable factoring without F11 ahead of F08, and it preserves the exact pause/resume semantics: the promise hangs until user action, with a 60s default-Skip timeout that fires regardless of caller behavior.

## Assumptions
- `slugLabel` derivation prefers original filename → URL host+path → raw sourceRef. Slug is kebab-cased + capped at 50 chars.
- For now, raw frontmatter values that contain `:` `#` quotes or backslashes are double-quoted YAML; values without those characters render unquoted. Matches the `escapeYaml` helper behavior. Tests assert quoted form for URL sources.
- Conversation kind passes body through verbatim and stamps `sourceRef = conversation:<threadId>:<turnIndex>`. F13 refines the persistence path; F08 just hands back a `FetchedSource`.

## Open questions
None.
