# Compliance iteration 1 — F66 wire-attachments-ui

## Acceptance criteria

- AC1 (orphan `chat/attachments.ts` reachable from `src/main.ts`): **PASS** — chain `src/main.ts` → `@/chat/wireAttachments` → `@/chat/attachments` + `@/chat/attachmentsStore` → `@/chat/attachments`. Both seams import real functions from the prior orphan module.
- AC2 (`AttachmentsStore.capture` stages + rejects per limits): **PASS** — `src/chat/attachmentsStore.ts:52-72`; covered by `tests/unit/attachmentsStore.test.ts > captures valid files and assigns preview URLs for images only`, `> rejects an attachment over ATTACHMENT_MAX_BYTES`, `> rejects once ATTACHMENT_MAX_COUNT_PER_TURN is reached`.
- AC3 (`remove(id)` revokes; `drainForNext` clears + revokes): **PASS** — `src/chat/attachmentsStore.ts:74-97`; covered by `tests/unit/attachmentsStore.test.ts > remove() revokes the blob URL and drops the item` and `> drainForNext() returns plain Attachments, clears state, and revokes every blob URL`.
- AC4 (`wireAttachments` exposes the four helper re-exports): **PASS** — `src/chat/wireAttachments.ts:27-33`; covered by `tests/unit/wireAttachments.test.ts > exposes the store + re-exported helpers`.
- AC5 (`dispose()` revokes + idempotent): **PASS** — `src/chat/wireAttachments.ts:34-39`; covered by `tests/unit/wireAttachments.test.ts > dispose() revokes outstanding blob URLs and is idempotent`.
- AC6 (existing tests stay green; new tests added): **PASS** — `pnpm test` 1054/1054 with 9 new cases.

## Scope coverage

- In scope "New `AttachmentsStore` wrapping the pure helpers": **PASS** — `src/chat/attachmentsStore.ts`.
- In scope "New `wireAttachments` helper …": **PASS** — `src/chat/wireAttachments.ts`.
- In scope "`main.ts.onload` constructs the wiring; `onunload` disposes": **PASS** — `src/main.ts` (new field `attachments: AttachmentsWiring | null`; `wireAttachments()` after user-tools wire; `dispose()` after `userTools?.dispose()`).
- In scope "Unit tests covering capture / rejection / remove / drain / revoke": **PASS** — see tests above.

## Out-of-scope audit

- Out of scope "Composer paste / drop handlers + tray UI": **CLEAN** — no `ComposerInput.tsx` / `ChatView.tsx` changes; the store is constructed but not yet consumed by DOM.
- Out of scope "`AgentRunner.send` multipart content routing + provider passthrough": **CLEAN** — no changes to `AgentRunner` or provider types.
- Out of scope "Deep compaction-aware attachment substitution": **CLEAN**.
- Out of scope "Cloud storage of attachments": **CLEAN**.
- Out of scope "Attachment previewing in transcript past the active turn": **CLEAN**.

## QA aggregate

`pnpm typecheck` / `pnpm lint` / `pnpm test` (1054/1054) / `pnpm build` (~396 KB) all PASS.

## Integration gate

- Entry point scanned: `src/main.ts`.
- New public modules: `src/chat/attachmentsStore.ts`, `src/chat/wireAttachments.ts`.
- Anchors matched: `src/main.ts` imports `wireAttachments` + `AttachmentsWiring` from `@/chat/wireAttachments`; the wiring imports `AttachmentsStore` from `@/chat/attachmentsStore`. `chat/attachments.ts` is referenced transitively via both new modules.
- Orphan delta: `src/chat/attachments.ts` removed from the orphan set (now reachable). Orphan count 42 → 41.

Verdict: PASS.

## Verdict: PASS
