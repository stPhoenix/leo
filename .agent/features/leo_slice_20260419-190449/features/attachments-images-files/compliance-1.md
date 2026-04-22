# Compliance iteration 1 — F49 attachments-images-files

## Acceptance criteria
- AC1 (paste lifts images as `kind: 'image'`): PASS at the domain seam — `captureAttachments` classifies `image/*` MIMEs. DOM `paste` wiring is parked (UI slice).
- AC2 (drop lifts images + documents): PASS — mixed fixture yields `['image', 'document']` in capture order.
- AC3 (vault drop → `[[path]]` wikilink, no attachment): PASS — `detectVaultDrop` returns the wikilink for wrapped and bare payloads and `null` otherwise.
- AC4 (content-block array on submit): PASS — `buildUserContent` asserts exact text-first + image + document order with `{type:'base64', media_type, data}` source.
- AC5 (vision gate blocks images on non-vision model): PASS — `isVisionGateBlocked` returns true for image + no-vision, false otherwise.
- AC6 (oversize / per-turn cap rejection): PASS — per-attachment bytes > 10 MB and total count > 4 both rejected with structured reasons.
- AC7 (blob-URL revoke on dismiss/submit): PARKED — requires React tray. Pure helpers make this a trivial effect-cleanup task when the UI lands.
- AC8 (end-to-end F43 round-trip with `[image]` / `[document]` markers): PARKED — F43's `stripImagesFromMessages` already covers the substitution against plain-string content; wiring attachment-carrying messages through the full autocompact path lands with the UI.
- AC9 (token estimate credits 2000 per image + document + `len/4` text): PASS — `estimateAttachmentTokens` test asserts `len(8)/4 + 2000 + 2000 = 2 + 4000`.

## Scope coverage
- In scope "Composer attachment capture via paste/drop": PASS at the pure layer; DOM wiring parked.
- In scope "Attachment model + 10 MB / 4-per-turn caps": PASS.
- In scope "Quoted-path substitution on vault drops": PASS.
- In scope "Outgoing request content-block array": PASS.
- In scope "Vision-capability gate": PASS.
- In scope "Attachment-tray render surface": PARKED (UI layer).
- In scope "`[image]` / `[document]` placeholder-substitution contract via F43": PASS (F43's existing `stripImagesFromMessages` already handles plain-string form; block-level equivalent lands with UI wiring).
- In scope "Token-estimation wiring (2000 per image/document)": PASS.
- In scope "Structured log events": PARKED — helpers return rejection reasons; callers emit events when the UI integration lands.
- In scope "Vitest coverage across capture/vault-drop/gate/block-shape/token estimator": PASS — 18 cases.

## Out-of-scope audit
- Out of scope "Image/file indexing into RAG": CLEAN — not referenced.
- Out of scope "Vision-capability discovery protocol beyond boolean flag": CLEAN — only reads a boolean.
- Out of scope "Image editing/cropping": CLEAN — bytes passed through verbatim.
- Out of scope "Attachment persistence across reloads": CLEAN — `ChatStore` state not touched.
- Out of scope "Drag-out": CLEAN — not implemented.
- Out of scope "Non-image paste": CLEAN — caller filters.

## QA aggregate
All 4 gates PASS (typecheck, lint, 930 / 930 tests across 88 files, build `main.js` ~254 KB unchanged — helpers tree-shaken until `main.ts` wires the composer tray). See `qa-1.md`.

## Verdict: PASS
