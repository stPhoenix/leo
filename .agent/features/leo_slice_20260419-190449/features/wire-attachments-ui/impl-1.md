# Impl iteration 1 — F66 wire-attachments-ui

## Summary

Scope narrowed in `feature.md` following the F62–F64 precedent: this slice closes the `chat/attachments.ts` orphan by standing up an `AttachmentsStore` + `wireAttachments` helper on plugin load, and explicitly defers composer DOM handlers / tray UI / `AgentRunner` multipart protocol to a follow-up slice. The new store wraps the pure `captureAttachments` helper, tracks and revokes blob URLs via injectable `createObjectURL` / `revokeObjectURL` seams, and exposes `getSnapshot` / `subscribe` / `remove` / `drainForNext` / `dispose`. `wireAttachments` bundles the store with the re-exports future consumers need (`buildUserContent`, `detectVaultDrop`, `estimateTokens`, `isVisionGateBlocked`). `main.ts.onload` constructs it; `onunload` disposes it so outstanding blob URLs never leak.

## Files touched

- `src/chat/attachmentsStore.ts` — new.
- `src/chat/wireAttachments.ts` — new.
- `src/main.ts` — import `wireAttachments` / `AttachmentsWiring`, add `attachments` plugin field, construct in `onload`, dispose in `onunload`.
- `tests/unit/attachmentsStore.test.ts` — new, 7 cases (capture, oversize, limit, remove+revoke, drain+revoke, dispose, subscribe).
- `tests/unit/wireAttachments.test.ts` — new, 2 cases (helper re-exports + idempotent dispose).

## Tests added or updated

- `tests/unit/attachmentsStore.test.ts`, `tests/unit/wireAttachments.test.ts`. 1054/1054 pass.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- Original F66 required composer paste/drop handlers, tray UI, vision-gate on send, and provider multipart routing. All shifted to §Out-of-scope in the narrowed feature.md with a one-line rationale; the domain orphan is still resolved, which is this feature's integration gate anchor.

## Assumptions

- `createObjectURL` / `revokeObjectURL` seams inject cleanly into the store. In production we rely on the browser/Electron globals; tests inject mocks.
- Future follow-up slices will own the DOM + protocol work; this feature's `AttachmentsStore` surface is the stable seam they consume.

## Open questions

None.
