# Impl iteration 1 — F08 tool-file-ops

## Summary

Landed `read_file`, `write_file`, `list_dir`, `delete_file` factories in `tools/fileOps.ts`. Each tool resolves user paths through `Sandbox.resolve` + `Sandbox.checkSafe`, maps every fs error to a typed result (no thrown `ENOENT` past the boundary), and updates `sandbox.bytes()` on writes/deletes. Inline binary detection (`looksBinary`) — null byte or > 30% control bytes triggers base64 encoding. Quota projection uses `sandbox.willExceedQuota(delta)` with `delta = newSize - existingSize` so re-writes don't double-count.

## Files touched

- `src/agent/externalAgent/adapters/inlineAgent/tools/fileOps.ts` — new: all four factories + `looksBinary` helper + result type unions.

## Tests added or updated

- `tests/unit/externalAgent/adapters/inlineAgent/fileOps.test.ts` — 22 cases:
  - `read_file`: AC1 path-escape, AC2 happy path + offset/limit + binary base64 + too_large, AC6 not_found.
  - `write_file`: AC3 parent dir creation + bytes update; quota_exceeded; base64 path.
  - `list_dir`: AC4 alphabetical + bytes; sub-path; not_found.
  - `delete_file`: AC5 file removal updates bytes; non-empty dir → not_empty; not_found.
  - All four tools: AC7 Zod boundary.
  - `looksBinary`: null byte detection, ASCII text, empty buffer.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- Open-question resolution: `looksBinary` reimplemented inline (matches `readFileShared.ts` heuristic at the level of "null byte or >30% control bytes"). FR-IA-04 isolation forbids cross-import; future cycle could promote a shared helper to `util/`.
- `write_file` quota check uses delta (new minus old size) so re-writing the same file does not erroneously trip the cap — extends the SRS rule which mentioned "projected total before writing".

## Assumptions

- `list_dir` does not recurse — confirmed per SRS §7 listDir output shape (`{ name, type, bytes? }[]`).
- `delete_file` rejects deleting the sandbox root explicitly (returns `path_outside_sandbox`) so the agent cannot wipe its own working dir.

## Open questions

- Atomic write semantics deferred to v2 per feature.md.
