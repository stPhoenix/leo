# Impl iteration 1 — F06 chat-composer-input

## Summary

Replaced the placeholder `ComposerInput` with a controlled, keyboard-first composer that forwards `submit` / `stopIntent` / `openCommandPalette` callbacks, gates on an `inlineConfirmationOpen` signal for Esc precedence, and listens to `prefers-reduced-motion` for animation toggling. Threaded the new hooks through `ChatRoot` and wired them in `ChatView` (default logger stubs for submit/stop plus a real palette dispatch via `app.commands.executeCommandById('command-palette:open')`). Added a 21-case Vitest DOM suite and updated `styles.css` so the composer has a grid layout with a visible hint line and a reduced-motion-gated send-button pulse.

## Files touched

- `src/ui/chat/ComposerInput.tsx` — full rewrite: controlled textarea with `useLayoutEffect` auto-resize, Esc precedence ladder, Cmd/Ctrl+K palette route, send/stop glyph via `setIcon`, reduced-motion listener with clean teardown (AC1–AC7).
- `src/ui/chat/ChatRoot.tsx` — exports `ComposerHooks` type and forwards a new optional `composer` prop to the composer, plus passes `setIcon` through (unchanged behaviour when omitted).
- `src/ui/chatView.tsx` — supplies default `onSubmit` / `onStopIntent` logger stubs and a real `onOpenCommandPalette` hooked to Obsidian's public command API.
- `styles.css` — grid layout with textarea / send-button / hint areas, transition tokens, `.is-reduced-motion` class suppresses the composer's own transitions (the shell-wide `@media (prefers-reduced-motion: reduce)` rule stays as a safety net).

## Tests added or updated

- `tests/dom/composerInput.test.tsx` — 21 cases covering every acceptance criterion: Enter-send + clear (AC1), whitespace-only gating (AC1), Shift+Enter newline preservation (AC1–AC2), IME-composition suppression (AC1), Esc precedence across confirmation-open / submitting / idle (AC3), Cmd-K + Ctrl-K palette opens with `preventDefault` (AC4), bare `k` does nothing (AC4), send-button disabled state tracking (AC1/AC5), DOM-order Tab traversal (AC5), submitting-state stop glyph + aria-label + click forwarding stop intent (scope: submit vs stop affordance), Enter-during-submitting does not re-fire submit, `prefers-reduced-motion` toggles the root class/dataset both ways without reload (AC6), initial `matches=true` wins on first paint (AC6), `matchMedia` `change` listener is removed on unmount (AC7), keydown after unmount cannot re-enter any callback (AC7), style audit asserts zero inline hex/rgb/outline-none on rendered composer DOM (AC5).

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

None.

## Assumptions

- Obsidian's global command palette ID is `command-palette:open`; the plugin calls `app.commands.executeCommandById('command-palette:open')` via a loose cast because Obsidian's public `.d.ts` does not expose `app.commands`.
- Auto-resize cap is `280px` (roughly eight lines); the cap lives only in a CSS-driven constant inside `ComposerInput.tsx` plus `max-height: 280px` in `styles.css`. `feature.md` did not pin a specific cap.
- `onSubmit` / `onStopIntent` defaults in `ChatView` log to the plugin logger; the real agent-runner wiring arrives with F07/F11.
- Reduced-motion class is composer-scoped (`.leo-composer-input.is-reduced-motion`); the shell-wide `@media (prefers-reduced-motion: reduce)` rule seeded by F04 is left intact as a cross-cutting safety net.

## Open questions

None.
