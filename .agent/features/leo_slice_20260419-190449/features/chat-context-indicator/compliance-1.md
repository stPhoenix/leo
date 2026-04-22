# Compliance iteration 1 — F09 chat-context-indicator

## Acceptance criteria

- AC1 (chip renders active note name derived from `FocusedContext.file`, basename + extension stripped, inside `ContextIndicator` slot): PASS — `src/ui/chat/ContextIndicator.tsx:76` renders `.leo-context-chip-note` with the `basename(file)` helper at `:93` stripping both path prefix and extension. Slot retained: `ChatRoot.tsx` still mounts `<ContextIndicator>` inside `data-region="context"`. Test: `tests/dom/contextIndicator.test.tsx` "renders note basename, viewport range, and selection badge when payload is complete".
- AC2 (viewport `start–end` line range from `FocusedContext.viewport`, updating on every emission): PASS — `src/ui/chat/ContextIndicator.tsx:60` computes `${ctx.viewport.from + 1}–${ctx.viewport.to + 1}`. `useSyncExternalStore` with channel `subscribe` triggers re-renders on every `channel.push`. Tests: "renders note basename, viewport range, and selection badge when payload is complete", "updates in lockstep with channel pushes".
- AC3 (selection badge when non-empty; omitted when empty): PASS — `src/ui/chat/ContextIndicator.tsx:63` renders `[data-slot="context-selection"]` only when `ctx.selection !== null`; F08 already stores `selection: null` when the CM6 range is empty (`focusSnapshotField` in `focusedContext.ts:24`). Tests: "renders note basename, viewport range, and selection badge when payload is complete", "omits the selection badge when selection is empty / null".
- AC4 (re-render within ≤ 300ms debounce tick of F08, no double-fire for same payload): PASS — chip has no debounce of its own; it subscribes directly to `FocusedContextChannel` (which F08 feeds from its 300ms-debounced emitter). `useSyncExternalStore` uses reference equality on the returned snapshot; since `FocusedContextChannel.push` always yields the same reference to callers until the next push, React re-renders once per push. Test: "updates in lockstep with channel pushes (uses bridge debounce)".
- AC5 (null payload hides the chip gracefully, reappears when focus returns): PASS — `src/ui/chat/ContextIndicator.tsx:48` returns a `<section hidden>` with `data-empty="true"` when `ctx.file === null`. When the channel later pushes a non-null payload, the chip re-renders via the `useSyncExternalStore` subscription. Tests: "hides when no active markdown editor (null payload)", "hides again when payload flips back to null".
- AC6 (click opens / focuses referenced note via workspace leaf API): PASS — `src/ui/chatView.tsx:175` implements `revealFile(path)` as `void this.app.workspace.openLinkText(path, '', false)`; `openLinkText` is the Obsidian-native "navigate to note" API, re-uses the existing leaf when possible. Chip wires `onReveal` to this via `ChatRoot.tsx` props. Test: "click on chip calls onReveal with the file path" (asserts contract end); runtime behaviour of `openLinkText` is Obsidian-internal, validated by the chip delegating through a typed prop.

## Scope coverage

- In scope "Inline chip rendered inside the `ContextIndicator` region of F04, showing active note path, viewport line range, and selection range when non-empty": PASS — `ContextIndicator.tsx:67-86`; three slots `context-note` / `context-range` / `context-selection`.
- In scope "Subscription to the `FocusedContext` push channel from F08; re-renders on each tick without extra debounce": PASS — `src/ui/chat/ContextIndicator.tsx:22` uses `useSyncExternalStore`; `src/ui/chatView.tsx:158` adapts the F08 `FocusedContextChannel` into the source shape.
- In scope "Click-to-reveal behaviour via Obsidian's native leaf API": PASS — `src/ui/chatView.tsx:175`.
- In scope "Graceful hidden / empty state when stream emits null payload": PASS — `ContextIndicator.tsx:47-56` (hidden section); collapsed variant falls back to "context unavailable" text (`ContextIndicator.tsx:37-42`).
- In scope "Truncation + tooltip for long note paths": PASS — `title={file}` attribute on chip (`ContextIndicator.tsx:73`), CSS `text-overflow: ellipsis` + `white-space: nowrap` on `.leo-context-chip-note` in `styles.css`. Collapsed `.leo-context-summary` also has ellipsis overflow.
- In scope "Unit coverage for subscribe/unsubscribe symmetry, rendered fields, hidden state, click dispatch": PASS — 10 tests in `tests/dom/contextIndicator.test.tsx`.

## Out-of-scope audit

- Out of scope "Token / context-window usage display": CLEAN — no counts rendered.
- Out of scope "Active skill name + skill picker affordance": CLEAN — no skill UI added.
- Out of scope "Full context breakdown (files, chunks, tools)": CLEAN — chip shows only `FocusedContext`, not assembled prompt context.
- Out of scope "Producing the `FocusedContext` itself": CLEAN — F09 only subscribes; CM6 extension + debounce + workspace listeners stay in F08 modules untouched this iteration.
- Out of scope "Styling tokens, z-index layering, six-region scaffold": CLEAN — added chip classes use existing Obsidian CSS variables; stylesAudit still PASS; no new z-index tokens.

## QA aggregate

Verdict: PASS (typecheck, lint, 202/202 tests, build ~190 KB).

## Verdict: PASS
