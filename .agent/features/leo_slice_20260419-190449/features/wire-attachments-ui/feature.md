# F66 — Wire attachments composer tray

## Purpose

Close the integration gap left by F49. `attachments.ts` ships `captureAttachments`, `buildUserContent`, `detectVaultDrop`, `isVisionGateBlocked`, `estimateAttachmentTokens`, but is not imported from any reachable file. This feature adds an `AttachmentsStore` and `wireAttachments` helper that construct on plugin load, exposing a stable seam for the composer tray / AgentRunner multipart send path to consume in a follow-up slice. Scope narrowed following the F62–F64 precedent — UI tray and provider-protocol multipart changes are deferred; this feature only closes the domain-module orphan and stands up the lifecycle.

## Scope

### In scope

- New `AttachmentsStore` (`src/chat/attachmentsStore.ts`) wrapping the pure helpers in `chat/attachments.ts`: stages, removes, drains, tracks/revokes blob URLs per the F49 lifecycle.
- New `wireAttachments` helper (`src/chat/wireAttachments.ts`) constructing the store, exposing `{ capture, detectVaultDrop, buildUserContent, estimateTokens, visionGate, store, dispose }` for downstream consumers.
- `main.ts.onload` constructs the wiring and holds a `userAttachments` reference; `onunload` calls `dispose()` which revokes any outstanding blob URLs.
- Unit tests covering store capture / rejection / remove / drain and blob-URL revoke invariants.

### Out of scope

- Composer paste / drop event handlers and tray UI — deferred to a follow-up slice that owns the ComposerInput / ChatView DOM wiring.
- `AgentRunner.send` multipart content routing + provider multipart passthrough — deferred to a follow-up slice that owns the OpenAI-compat / cloud-provider protocol change.
- Deep attachment-aware summarization / compaction (F43 owns placeholder substitution).
- Cloud storage of attachments (keep in-memory per turn).
- Attachment previewing in transcript past the active turn.

## Acceptance criteria

1. Orphan `chat/attachments.ts` becomes reachable from `src/main.ts`; §5.4 audit removes it.
2. `AttachmentsStore.capture(files)` stages accepted attachments and returns rejection reasons, respecting `ATTACHMENT_MAX_COUNT_PER_TURN` and `ATTACHMENT_MAX_BYTES`.
3. `AttachmentsStore.remove(id)` revokes the associated blob URL and drops the attachment; `AttachmentsStore.drainForNext()` returns the full set and clears the store, revoking every blob URL.
4. `wireAttachments` exposes `detectVaultDrop`, `buildUserContent`, `estimateTokens`, and `isVisionGateBlocked` re-exports so future consumers import from one seam.
5. `wireAttachments.dispose()` revokes any outstanding blob URLs; calling it twice is a no-op.
6. All existing tests stay green; new tests added per §Scope.

## Dependencies

F06 (composer input) · F07 (streaming) · F10 (agent controller) · F41 (token estimator) · F49 (attachments domain). All `feature-complete`.

## Implementation notes

- [Architecture §3.2 UI — ChatView tree](../../../../architecture/architecture.md#32-ui) — tray lives between `MessageList` and `ComposerInput`.
- [Code style — React](../../../../standards/code-style.md) — blob URL lifecycle must be explicit; use `URL.createObjectURL` + `URL.revokeObjectURL` in the same component lifetime.
- F49 compliance-1 calls out "AC7/AC8 tray-blob-lifecycle + F43 e2e parked pending UI mount".

## Open questions

- Drop target scope: only the composer, or the full `ChatView` pane? Default: full pane, with a visual indicator only when dragging files.
