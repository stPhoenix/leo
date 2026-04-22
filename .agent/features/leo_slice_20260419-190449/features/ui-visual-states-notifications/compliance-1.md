# Compliance iteration 1 — F13 ui-visual-states-notifications

## Acceptance criteria

- AC1 (typed `VisualState` union = exact 7 states, `data-visual-state` attribute, Obsidian CSS vars, zero hex/rgb): PASS — `src/ui/visualStates.ts:1-10` defines the union with exactly those seven members; `VISUAL_STATES` in `:12-20` mirrors the literal list and is covered by `tests/unit/visualStates.test.ts` "exposes exactly the seven states specified by FR-UI-06". `styles.css` block `[data-visual-state="awaiting-confirmation|error|cancelled|edit-locked"]` uses only `var(--color-yellow)`, `var(--text-error)`, `var(--interactive-accent)`; `tests/unit/stylesAudit.test.ts` continues to enforce no hex/rgb/hsl literals.
- AC2 (animations suppressed under `prefers-reduced-motion: reduce`; attribute still updates): PASS — reduced-motion media query in `styles.css` was extended with `.leo-chat-root[data-visual-state] { transition: none !important }`. `applyVisualState` has no animation logic — it only mutates attributes — so the attribute always flips regardless of the media query (tested by the attribute-write and ARIA-transition cases).
- AC3 (`iconFor` resolves built-in tool ids through Obsidian's built-in Lucide icon names via `setIcon`): PASS — `src/ui/toolIcons.ts:6-12` maps `read_note` → `file-text`, `create_note` → `file-plus`, `append_to_note` → `file-plus-2`, `edit_note` → `pencil`, `search_vault` → `search`; no external icon font is imported. Test `tests/unit/toolIcons.test.ts` "resolves built-in read / write / search / edit tool ids to built-in Lucide icons".
- AC4 (MCP pattern `mcp.<serverId>.<tool>` → generic MCP icon + server label slot sourced from consumer-supplied lookup): PASS — `src/ui/toolIcons.ts:16-26` branches on `mcp.` prefix and returns `iconName='plug'` plus `serverId` + `labelKey='mcp.server.<serverId>'`; `renderToolIcon` resolves the label via the injected `labels` lookup. Tests: "returns the generic MCP icon plus serverId for mcp.<serverId>.<tool>", "renderToolIcon resolves an MCP server label via the consumer-supplied lookup", "falls back to the serverId when the label lookup returns null".
- AC5 (`Notifications` exposes notice / status / blockingError + each channel reaches the expected surface): PASS — `src/ui/notifications.ts:36-82`. `notice()` delegates to the injected `NoticeChannel.show`; `status(key, message)` lazily creates one `StatusBarChannel` per key and calls `setText`; `blockingError(host, content)` delegates to the injected `InlineDialogHost.mount`. Tests in `tests/unit/notifications.test.ts` "channel routing per FR-UI-08".
- AC6 (tool confirmation routed exclusively to inline region; never native Modal): PASS — `src/ui/notifications.ts:87` only reaches the injected `InlineConfirmationHost.present`; the interface enforces `isNativeModal(): false`. Test "requestToolConfirmation() is routed exclusively to the inline confirmation host" asserts `inlineConfirmation.isNativeModal()` returns `false` and `present` is called. No code path in `Notifications` ever imports `obsidian`'s `Modal`.
- AC7 (unmount / dispose tears down subscriptions, removes status-bar items, dismisses inline modal, no dangling DOM or listeners): PASS — `src/ui/notifications.ts:104-114` `dispose()` iterates `this.statusItems` calling `remove()`, dismisses active blocking error + active confirmation. Test "dispose tears down status bars, active blocking error, and active confirmation".

## Scope coverage

- In scope "Unified `VisualState` union with canonical data attribute + Obsidian palette + ARIA hints": PASS — see AC1/AC2.
- In scope "Per-tool icon registry via `iconFor(toolId)` + `setIcon`": PASS — see AC3.
- In scope "MCP generic icon + `<server-name>` label slot": PASS — see AC4.
- In scope "`Notifications` helper with three channels + tool-confirmation hard constraint": PASS — see AC5/AC6.
- In scope "CSS variable tokens with prefers-reduced-motion off switch": PASS — see AC2.
- In scope "Unit coverage (icon registry, state attribute, channel wiring, no-native-modal assertion)": PASS — 15 new cases across three test files.

## Out-of-scope audit

- Out of scope "Streaming render pipeline and animated cursor implementation": CLEAN — no changes to `StreamingTurnController` or cursor rendering; we only reference the `streaming` state token.
- Out of scope "Edit-lock CM6 decoration / readonly / 3-second highlight": CLEAN — the `edit-locked` token is declared but no CM6 code added.
- Out of scope "Tool-confirmation inline dialog content": CLEAN — only the routing contract ships; no Allow/Deny UI added.
- Out of scope "Plan approval dialog content": CLEAN — the `InlineDialogHost` API is parameterised; no Approve / Edit / Reject buttons defined here.
- Out of scope "MCP server-name label resolution / per-server metadata": CLEAN — `labels` lookup is injected, not implemented; default path returns `serverId` when lookup is absent.
- Out of scope "Specific status-bar contents (provider / index / MCP)": CLEAN — `Notifications.status(key, message)` is a neutral channel; each owning feature supplies its own `key` and text later.

## QA aggregate

Verdict: PASS (typecheck, lint, 265/265 tests, build ~200 KB unchanged — F13 modules are contract-only and not yet consumed by `main.ts`).

## Verdict: PASS
