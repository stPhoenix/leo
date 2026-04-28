# Remediation 1

Workspace: `/home/bs/PycharmProjects/leo/.agent/features/leo_slice_20260419-190449`
Iteration: 1
Verdict of verification-1.md: **FAIL** (Check 4 + Check 6).

| Gap | Action | Files changed |
|-----|--------|---------------|
| 1 (Check 4 — F38 UI missing) | Dispatched ui-ux-engineer | `features/cloud-providers-safestorage/ui.md`; `outline.md`; `state.md` (row 90) |
| 2 (Check 6 — short `## Open questions` bodies) | Edited 12 feature.md files | `features/<slug>/feature.md` × 12 |

## Gap 1 — Check 4 — F38 cloud-providers-safestorage UI doc missing

F38 is declared `ui-needed=yes` in `features-index.md` (row 44) but no `features/cloud-providers-safestorage/ui.md` existed. Per the `/plan-feature` orchestration protocol:

1. Appended row `| 90 | ui-ux-engineer | 1 | running | — | — |` to `state.md` before dispatch.
2. Executed the `ui-ux-engineer` role to produce `features/cloud-providers-safestorage/ui.md` (≈25 KB). The new doc contains the required sections:
   - **## Layout** — four ASCII wireframes:
     1. Provider section populated with OpenAI selected + API-key password field + Show/Clear buttons + pricing overrides.
     2. safeStorage-unavailable state — persistent warning banner above the Settings body + per-field inline warning + one-shot `Notice` with `[Open settings]` CTA.
     3. Custom provider expanded with `baseURL` + auth-header `{name, prefix?}` + optional `pricing`.
     4. `$N.NN` cost slot appended to the F12 token-usage footer only when the active provider has a pricing table.
   - **## State machine** — three Mermaid `stateDiagram-v2` diagrams plus equivalent adjacency lists:
     - `ProviderSelectionMachine` (`local ↔ cloud_selected ↔ cloud_awaiting_key ↔ cloud_ready`) blocking cloud fetches until both opt-in and a stored key are present (AC 6 / AC 7).
     - `SafeStorageMachine` (`probing → encrypted_available | obfuscated_fallback`) with no mid-session mode flip and per-record `{mode, value}` persistence.
     - `CostSlotMachine` (`hidden ↔ visible`) driven by active-provider pricing plus terminal `StreamEvent.usage`.
   - **## Event flow** — six flows covering first-time save (safeStorage OK), first-save on fallback, clearing a key, cost-slot light-up, switching between cloud providers, and the keyring-missing-between-sessions mode-mismatch re-entry.
   - **## Component mapping** — every UI block bound to a `tech-stack.md` row (Platform APIs: `PluginSettingTab`, `Notice`, `setIcon`, Electron `safeStorage`, `loadData`/`saveData`; UI Layer: React 18, Icons, Styling; Agent Layer: LLM bindings) plus F01 / F03 / F12 / F13 feature docs for the logger, settings host, token-usage footer, and notification channel. Explicit forbidden list keyed to [FR-UI-08](./context.md) (no native `Modal`, no new top-level settings section, no plaintext in DOM post-save, no key material logged above `debug`).
   - **## Back-link** — `[./feature.md](./feature.md)` at top and at bottom of the document.
3. Appended `- [F38 cloud-providers-safestorage UI](./features/cloud-providers-safestorage/ui.md)` to Phase 3 of `outline.md`.
4. Post-write verification: `ls -la` confirms `ui.md` exists with 25 152 bytes (> 100 B threshold the verifier uses); updated row 90 in `state.md` to `Status=done` with a one-sentence summary and `features/cloud-providers-safestorage/ui.md` as the output doc.

## Gap 2 — Check 6 — 12 feature.md files with `## Open questions` body ≤ 20 chars

Per the verifier's per-file listing, each offending file's `## Open questions` body was either `None.` (5 chars) or `- None.` (7 chars). Applied the deterministic one-line replacement prescribed in the verification report to every file, yielding a 118-char bullet ≥ 20 chars:

```
- None. Acceptance criteria and implementation notes exhaust this feature's scope; no decisions are deferred at this slice.
```

Files edited (relative to `features/`):

- `chat-sidebar-view/feature.md` (was `None.`)
- `chat-message-list-markdown/feature.md` (was `None.`)
- `chat-composer-input/feature.md` (was `None.`)
- `chat-streaming-stop/feature.md` (was `None.`)
- `editor-bridge-focused-context/feature.md` (was `None.`)
- `chat-context-indicator/feature.md` (was `None.`)
- `chat-message-queue/feature.md` (was `None.`)
- `token-usage-indicator/feature.md` (was `None.`)
- `ui-visual-states-notifications/feature.md` (was `None.`)
- `edit-lock-transactions/feature.md` (was `None.`)
- `tools-write-vault/feature.md` (was `- None.` — leading-bullet variant)
- `plan-approval-dialog/feature.md` (was `None.`)

No file actually had a genuine open question deferred at this slice; the standard closure-statement form was used everywhere. No other section was touched; the file diff in each case is a one-line replacement within the `## Open questions` block.

## Summary

- Check 4 remediation: **1 new ui.md + 1 outline.md entry + 1 state.md row added/updated**.
- Check 6 remediation: **12 feature.md files patched** with a deterministic closure bullet.
- Re-verification expected to PASS both checks; all other checks already passed in `verification-1.md`.
