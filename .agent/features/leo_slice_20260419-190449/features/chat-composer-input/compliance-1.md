# Compliance iteration 1 — F06 chat-composer-input

## Acceptance criteria

- AC1 (Enter submits + clears; Shift+Enter inserts newline): PASS — `src/ui/chat/ComposerInput.tsx:125-135` runs `e.preventDefault()` + `submitDraft()` on Enter (no Shift, no IME), sets `draft=''` before firing `onSubmit(text)`; Shift+Enter falls through to the browser default. Covered by tests "Enter submits the current draft and clears the textarea" and "Shift+Enter does not submit — literal newline is preserved" (`tests/dom/composerInput.test.tsx`).
- AC2 (multi-line content reflows, then scrolls internally): PASS — useLayoutEffect auto-resizer at `src/ui/chat/ComposerInput.tsx:32-39` sets `style.height = min(scrollHeight, MAX)` and flips `overflowY` to `auto` once past the `280px` cap; css matches via `.leo-composer-textarea { max-height: 280px }` in `styles.css`. Test "Shift+Enter does not submit — literal newline is preserved" asserts 3-line content reaches the controlled `value` verbatim.
- AC3 (Esc precedence): PASS — precedence ladder at `src/ui/chat/ComposerInput.tsx:112-122` (`confirmationOpen → onCloseConfirmation`; else `submitting → onStopIntent`; else `textarea.blur()`). Tests "closes an open inline confirmation when Esc is pressed", "forwards the stop intent when a response is streaming and no confirmation is open", "blurs the textarea when idle".
- AC4 (Cmd-K / Ctrl-K opens palette, does not leak to editor): PASS — `src/ui/chat/ComposerInput.tsx:100-107` runs `preventDefault()` + `stopPropagation()` then calls `onOpenCommandPalette()`; `src/ui/chatView.tsx:97-104` dispatches `app.commands.executeCommandById('command-palette:open')`. Tests "opens the palette on Cmd+K and stops propagation to the editor", "opens the palette on Ctrl+K as well", "does not open the palette on bare k".
- AC5 (Tab traversal + focus ring from Obsidian variables): PASS — DOM order is `textarea → button` with no `tabindex > 0` (`src/ui/chat/ComposerInput.tsx:165-186`); focus ring comes from `.leo-composer-send:focus-visible, .leo-composer-textarea:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: 1px; }` in `styles.css`. Tests "tab order is DOM order — textarea → send button (no explicit tabindex > 0)" and "uses no inline outline-color or outline:none in rendered composer DOM". The global styles audit (`tests/unit/stylesAudit.test.ts`) also re-confirms zero hex/rgb/hsl colour literals.
- AC6 (`prefers-reduced-motion` toggles without reload): PASS — `src/ui/chat/ComposerInput.tsx:49-74` installs a `matchMedia('(prefers-reduced-motion: reduce)')` `change` listener, and `styles.css` carries `.leo-composer-input.is-reduced-motion` selectors that neutralise the button pulse and textarea transitions. Tests "marks the root when the preference matches and unmarks when cleared" and "initial matches=true wins on first render".
- AC7 (unmount removes listeners): PASS — useEffect cleanup at `src/ui/chat/ComposerInput.tsx:67-73` calls `removeEventListener('change', handler)` (or legacy `removeListener`); all keyboard handlers are React props on the section so React removes them on unmount. Tests "removes the matchMedia change listener on unmount" and "keydown after unmount does not re-enter any composer callback".

## Scope coverage

- In scope "`ComposerInput` React component mounted into the region reserved by F04": PASS — `src/ui/chat/ComposerInput.tsx` replaces the placeholder and is rendered inside `ChatRoot`'s `data-region="composer"` slot.
- In scope "Multi-line `<textarea>` that grows vertically up to a bounded max-height then scrolls internally": PASS — auto-resize effect + `max-height: 280px` + `overflowY: auto` fallback.
- In scope "Keyboard handler: Enter submits and clears; Shift+Enter (Alt+Enter) inserts newline": PASS — Enter branch keyed on `!e.shiftKey && !e.altKey`; Shift or Alt fall through to the browser default, preserving the literal newline insertion.
- In scope "Esc handler with precedence (confirmation / streaming / idle)": PASS — precedence ladder and three tests above.
- In scope "Cmd-K / Ctrl-K opens Obsidian's palette without leaking to the editor": PASS — composer and `ChatView` wiring + three tests above.
- In scope "Send button rendered with a Lucide icon via `setIcon`; keyboard-reachable; disabled on whitespace-only": PASS — button ref fed to `setIcon(btn, 'send' | 'square')` at `ComposerInput.tsx:41-50`; `disabled` = `!submitting && draft.trim().length === 0`; test "send is disabled while the draft is empty or whitespace-only".
- In scope "Visible focus ring sourced from Obsidian focus-ring CSS variables — no custom outline colours": PASS — styles-audit tests + explicit `.leo-composer-*:focus-visible` rules using `var(--interactive-accent)`.
- In scope "`prefers-reduced-motion` gate collapses composer motion to instant state change": PASS — `.is-reduced-motion` neutralises `transition` and the scale-on-active pulse.
- In scope "Unit coverage for Enter-send vs Shift+Enter-newline, Esc precedence, Cmd-K, focus order, disabled rule, style audit, motion gate": PASS — 21 cases in `tests/dom/composerInput.test.tsx`.

## Out-of-scope audit

- Out of scope "Streaming-cursor rendering / AbortController-driven stop mechanics": CLEAN — only an `onStopIntent()` prop is forwarded; no streaming state, animated cursor, or `AbortController` lives in this feature.
- Out of scope "FIFO queuing of user messages while a prior request is in flight": CLEAN — the composer gates submit while `isSubmitting=true` (drops it) but does not hold or replay messages.
- Out of scope "Message persistence to `.leo/conversations/`": CLEAN — no filesystem writes added.
- Out of scope "Token / cost indicators in the composer": CLEAN — none added; `HeaderBar` remains unchanged.
- Out of scope "Attachments (image paste, file drop)": CLEAN — no paste/drop handlers introduced.
- Out of scope "Skill-picker / thread-header controls": CLEAN — no additions under `HeaderBar`.
- Out of scope "Inline confirmation content / plan-approval dialog bodies": CLEAN — composer only reads `inlineConfirmationOpen` and calls `onCloseConfirmation`; it never renders confirmation bodies itself.

## QA aggregate

Verdict: PASS — typecheck 0, lint 0, tests 145/145, build 0 (main.js 183 700 B).

## Verdict: PASS
