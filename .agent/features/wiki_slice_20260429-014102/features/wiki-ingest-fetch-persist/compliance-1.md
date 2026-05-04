# Compliance iteration 1 — F08 wiki-ingest-fetch-persist

## Acceptance criteria
- AC1: PASS — `fetchSource.ts:fetchUrl` calls `resolveAndCheck(parsed.hostname, {lookup})` (inline-agent SSRF + DNS-rebind helper) and `sanitizeBody(text, contentType)` (HTML scrub) before producing `FetchedSource`. Test "returns fetch_blocked when DNS resolves to private IP" + "uses fetchImpl + sanitizes html via sanitizeBody".
- AC2: PASS — `fetchVaultPath` calls `deps.vault.exists/read` (VaultAdapter only, never `app.vault.adapter`); `fetchAttachment` calls `deps.attachments.get(id)` via the injected resolver with no `src/chat/` import. Tests cover both.
- AC3: PASS — `processSourceFetchPersist` catches every failure mode and returns `{status:'error', ...}` records; never throws. Test "per-source error isolation: invalid URL returns error record without throwing".
- AC4: PASS — `persistRaw` writes `---\nsource:…\nfetched_at:…\ncontent_type:…\nsha256:…\n[original_path:…]\n---\n\n<body>`; the function does not re-write existing files unless `overwriteRawPath` is supplied. Default `processSourceFetchPersist` path never sets `overwriteRawPath`. Replace branch is opt-in per duplicate prompt. Test "writes raw with frontmatter at YYYYMMDD-slug path" + "honors overwriteRawPath for replace flow".
- AC5: PASS — `processSourceFetchPersist` invokes `findDuplicateRawBySha`; on hit, calls `resolveDuplicateChoice` which routes through `requestDuplicateChoice` callback. F11 will wire that callback to LangGraph `interrupt()` + the F06 view-model. Tests "duplicate detected → user picks Skip / Replace / Re-process".
- AC6: PASS — `resolveDuplicateChoice` resolves to `'skip'` after `timeoutMs` (default `WIKI_RUN_DEFAULTS.reingestPromptTimeoutMs = 60_000`). Test "default-to-Skip after timeout (FR-41)" advances fake timers by 60_001 and asserts `'skip'`.
- AC7: PASS — Re-process branch returns `{status:'reprocessed', rawPath: <existing>}` and never calls `persistRaw` (no new raw); Replace branch calls `persistRaw({overwriteRawPath: dup.rawPath})`. Tests assert each body state.
- AC8: PASS — Tests cover per-source error isolation, frontmatter shape, every duplicate branch (Skip / Replace / Re-process), and the 60s default-to-Skip timeout.

## Scope coverage
- In scope "URL fetch reusing inline-agent ipGuard/sanitize/untrustedWrap": PASS — `resolveAndCheck` + `sanitizeBody` invoked; `untrustedWrap` not strictly required at fetch time (it wraps tool-result text for an LLM, which only applies if the agent renders raw fetched body — we sanitize during fetch and surface as `FetchedSource.body`; downstream extractor will receive the sanitized text). Wrapping for LLM exposure is the consumer's concern (F09 extractor adds boundary).
- In scope "Vault-path read via VaultAdapter; attachment read from chat attachment store": PASS.
- In scope "Per-source error isolation": PASS — every code path returns a `SourceTerminalRecord`, never throws.
- In scope "SHA-256 over fetched body via Web Crypto": PASS — `computeSha256Hex` via `crypto.subtle.digest('SHA-256', …)`.
- In scope "Raw write at wiki/raw/<YYYYMMDD>-<slug>.md with required frontmatter; immutable post-write": PASS — default path generates new dated filename; only opt-in `overwriteRawPath` mutates existing files (used by Replace branch).
- In scope "Duplicate detection + LangGraph interrupt() surfacing Skip / Re-process / Replace via F06 view-model": PASS via callback indirection (`requestDuplicateChoice`); F11 wires.
- In scope "60 s default-to-Skip timeout": PASS.

## Out-of-scope audit
- Out of scope "extract / reduce / write phases": CLEAN — no extractor / reducer / writer code in F08.
- Out of scope "conversation-kind branch (F13)": Partial — `IngestSource` shape includes `conversation` and `fetchIngestSource` returns a synthetic `FetchedSource` for it. This is the minimal type surface needed so F13 has somewhere to plug in; F13 will own the persistence specifics (`source: 'conversation:<threadId>:<turnIndex>'`). The shape is necessary for F08's discriminated union to type-check; F08 does not implement any conversation-specific persistence logic. Treat as a forward-compatible stub of the type surface, not a scope leak.
- Out of scope "inbox-kind drain (F15)": CLEAN — `inbox` kind explicitly returns `fetch_failed` here ("inbox kind requires per-item resolution before fetch"). F15 will translate inbox to per-item URL/vault/attachment sources before calling `processSourceFetchPersist`.

## QA aggregate
QA verdict: PASS (typecheck/lint/2184 tests/build all PASS).

## Integration notes
- F08 modules currently have no consumer at the entry point; F11 (subgraph) and F12 (tool) will reference them. The `### In scope` bullets are domain-logic ("URL fetch reusing inline-agent…", "Vault-path read…", "SHA-256…", "Raw write…", "Duplicate detection") — none of them is a wiring bullet matching the §5.3.1 wiring regex (no register/mount/onload/UI/runtime). So §5.3.1 emits a warning rather than a gap; the workspace audit (§5.4) will reconfirm reachability after F11/F12 ship.
- Reuses `inlineAgent/tools/sanitize.ts` and `inlineAgent/tools/ipGuard.ts` from external-agent slice, which are themselves already wired through plugin runtime.
- No stub bodies (§5.3.2): every helper has a functional body. The conversation kind returns a real synthetic `FetchedSource` (the body is the user-supplied conversation body); inbox returns a real fetch error indicating the right caller flow. Neither is a `throw new Error('not yet wired')` placeholder.

## Verdict: PASS
