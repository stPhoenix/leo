# Impl iteration 1 — F49 attachments-images-files

## Summary

Added `src/chat/attachments.ts` with pure attachment capture + content-block assembly + vault-drop detection. `captureAttachments(files, opts)` lifts `{name, mimeType, bytes, size}` inputs into `Attachment[]`, classifies `image/*` as `kind: 'image'` and the `application/pdf | application/json | text/*` allowlist as `kind: 'document'`, enforces the 10 MB per-attachment and 4-per-turn caps with structured `{kind: 'oversize' | 'limit_reached' | 'unsupported_mime'}` rejection reasons, and never mutates the caller's `current` array. `buildUserContent(text, attachments, base64)` emits the multimodal content-block array — `[{type:'text', text}, ...{type:'image'|'document', source:{type:'base64', media_type, data}}]` — in capture order. `detectVaultDrop({textPlain, fileExists?})` recognises Obsidian's wrapped `[[path]]` payload and bare vault-relative paths with known extensions so the caller can insert a wikilink instead of creating an attachment. `isVisionGateBlocked({attachments, modelSupportsVision})` blocks turn submission when `kind: 'image'` attachments exist but the active model lacks vision support. `estimateAttachmentTokens(blocks)` credits each `image` / `document` block at 2000 tokens and each text block at `len/4` (without the 4/3 padding that F41's orchestrator adds), matching `IMAGE_MAX_TOKEN_SIZE` from compact.md §4.

## Files touched

- `src/chat/attachments.ts` — new. Exports `ATTACHMENT_MAX_BYTES`, `ATTACHMENT_MAX_COUNT_PER_TURN`, `Attachment`, `AttachmentKind`, `AttachmentRejectReason`, `CaptureResult`, `CaptureFileInput`, `CaptureOptions`, `captureAttachments`, `buildUserContent`, `toBase64`, `detectVaultDrop`, `isVisionGateBlocked`, `estimateAttachmentTokens`, and the `ContentBlock` / `ContentBlockText` / `ContentBlockImage` / `ContentBlockDocument` shapes.

## Tests added or updated

- `tests/unit/attachments.test.ts` — 18 cases covering AC1–AC6, AC9:
  - **constants**: 10 MB / 4-per-turn caps.
  - **AC1/AC2/AC6 capture**: image paste, PDF drop, mixed image+doc, oversize reject, 4-cap reject, unsupported-MIME reject, `text/plain` allowlisted.
  - **AC3 vault drop**: wrapped wikilink, bare path, non-path fallthrough to `null`, `fileExists` guard.
  - **AC4 content blocks**: text-first + attachments in capture order + empty-attachments case.
  - **AC5 vision gate**: blocks images on non-vision model; allows with vision; passes document-only without vision.
  - **AC9 token estimation**: 2000 tokens per image + per document + `len/4` for text.

Net delta: +18 tests (912 → 930 passing).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **UI mount and DOM event wiring are parked.** AC7 (blob-URL revoke on dismiss/submit) and AC8 (round-trip through F43 `stripImagesFromMessages`) both require F06 composer + F43 wiring and are deferred until `main.ts` wires the attachment tray. Iteration 1 ships the pure capture + content-block + gate helpers + tests that every higher-AC depends on.
- **`IMAGE_MAX_TOKEN_SIZE` constant is not re-exported from F41**; `estimateAttachmentTokens` hard-codes `2_000` via the same rule F41 uses. A small dependency seam can be added if callers need the constant separately.
- **Vault-drop heuristic** (Open question §3): uses a strict file-extension regex plus optional `fileExists(path)` guard; wrapped wikilinks win over raw paths. `TFile` lookup is deferred until the UI consumes this helper inside the Obsidian `App`.
- **Document allowlist** (Open question §6): ships `application/pdf`, `application/json`, `text/*` as the default set; overridable via `CaptureOptions.documentMimeAllowlist`.
- **Attachment persistence** (Open question §4): not part of this slice — F14 conversation-persistence already stores arbitrary content-block arrays.
- **Non-image paste** (Open question §5): intentionally asymmetric — paste only handles images (the caller filters `ClipboardEvent.clipboardData.items` before calling `captureAttachments`).

## Assumptions

- Callers wire DOM events (`paste`, `drop`, `dragover`) into composer-level handlers that convert `ClipboardEvent` / `DragEvent` payloads into `CaptureFileInput[]` and pass them to `captureAttachments`. This keeps the DOM-level code thin and this module unit-testable without jsdom specifics.
- `base64` is injected so callers can swap in a Web Worker encoder if needed. Default `toBase64` uses `btoa` on a `String.fromCharCode` round-trip; this is fine for the <10 MB cap but will warrant a streaming encoder for larger attachments later.
- Vision-capability metadata lives on the caller's model-capability source (Open question §2); this helper only reads a boolean.

## Open questions

- **F06 composer + F04 attachment tray UI**: parked until `main.ts` wiring lands.
- **Per-attachment encoder strategy**: current `toBase64` is sync; can be replaced without breaking the public shape.
- **Vault `TFile` lookup**: `detectVaultDrop` accepts an injected `fileExists` predicate; Obsidian binding lands with the composer wiring.
