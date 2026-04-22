# Impl iteration 1 — F19 tools-write-vault

## Summary

Added `create_note` and `append_to_note` `ToolSpec`s under `src/tools/writeTools.ts`, both with `requiresConfirmation: true`, the same hand-rolled path-traversal guard used by `read_note` (reused via `isSafeVaultPath` export), and single-Vault-call apply logic via the `VaultAdapter` seam. Both tools register into the singleton `ToolRegistry` at `Plugin.onload`, sitting alongside `read_note`. Every invocation now funnels through the F17 confirmation gate because `requiresConfirmation: true` — the Vault write happens only after the user clicks Allow-once / Allow-for-thread (or the tool id is already in `thread.metadata.allowedTools`).

## Files touched

- `src/tools/writeTools.ts` — new: `createCreateNoteTool(vault)` + `createAppendToNoteTool(vault)`; shared `validateArgs` (`{path, content}` string-string with `isSafeVaultPath` check returning `"unsafe path"`). `create_note` short-circuits to `{ok:false, error:"file exists"}` when `vault.exists(path)` is true. `append_to_note` returns `{ok:false, error:"not found"}` when the target is absent; otherwise reads-then-writes once, prepending `\n` only when the existing file does not already end with one. Both invocations perform at most one `vault.write` call.
- `src/main.ts` — registers both tools in the `ToolRegistry` after `read_note`.
- `tests/unit/writeTools.test.ts` — 9 cases: create happy, create already-exists with no write, create traversal rejection via validate, create arg-type validation; append happy + newline separator rule + already-ends-with-newline variant, append not-found with no write, append traversal rejection, append platform-error surface.

## Tests added or updated

- 9 new cases. Full suite: 42 files, 352/352 pass.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- Feature references `app.vault.append`; the implementation uses `VaultAdapter.read` + `VaultAdapter.write` (read existing, append content, write back) because the `VaultAdapter` seam introduced by F14 exposes `read` / `write` but not `append`. Net effect is identical (bytes appended); swap-in for a native `append` is a one-method change when F14's adapter is extended.
- `append_to_note`'s newline-separator heuristic is a small convenience (do not create `\n\n` on files already ending in `\n`). Feature doesn't pin the separator contract; this mirrors Obsidian's `Vault.append` documented behaviour.

## Assumptions

- The `isSafeVaultPath` guard from F16 is sufficient for write tools; both tools share the exact same validator so any future tightening lands in one place.
- Bytes count is computed via `TextEncoder` (UTF-8) for both tools; payloads are never logged, only lengths, per code-style "Logging".

## Open questions

None.
