# F19 — Lint confirm UI + writer + `delegate_wiki_lint` + `/wiki-lint`

## Purpose

The agent-facing surface for lint: tool with `requiresConfirmation:true`, `/wiki-lint` slash, the multi-select findings UI in CONFIRMING, the WRITING phase's writer (reusing F10 plus a `SCHEMA.md` patch path), and the per-run schema-patch confirm flow. Covers [context.md `Lint Trigger & Confirmation`](../../context.md#lint-trigger--confirmation) FR-20, FR-21, FR-22, [context.md `Lint Subgraph — Phases`](../../context.md#lint-subgraph--phases) FR-37, FR-38, the bundle constraint [NFR-04](../../context.md#non-functional-requirements), and the `/wiki-lint` half of FR-52.

## Scope

- In:
  - `delegate_wiki_lint(scope?)` registered with `requiresConfirmation:true` (FR-20, FR-21).
  - Scope discriminated union: `{kind:'all'}` | `{kind:'pages',glob}` | `{kind:'orphans'}`, default `all` (FR-20).
  - Confirmation actions: **Run wiki lint** / **Deny** via `confirmationController` (FR-21).
  - On Run, mount widget + suspend tool until subgraph terminal (FR-22).
  - CONFIRMING surface: per-finding accept/reject toggle + Accept all / Reject all / Apply selected; schema patches require explicit per-run confirm (FR-37).
  - WRITING reuses F10 writer plus a dedicated `SCHEMA.md` patch path; appends a single `log.md` entry recording accepted/rejected counts (FR-38).
  - Terminal DONE → `{ ok:true, lintId, findings:{total,accepted,rejected}, pagesEdited, schemaEdited, durationMs }` (FR-39).
  - `/wiki-lint` slash invokes the tool with default args (FR-52).
- Out: scan / check / propose nodes (F16/F17); FSM driver (F18).

## Acceptance criteria

1. Tool registered with `requiresConfirmation:true`; actions Run wiki lint / Deny (FR-20, FR-21).
2. Deny → `{ ok:false, denied:true }`; main agent continues normally (FR-18 ref by analogy — denial path is the same primitive).
3. Run mounts the F06 widget + suspends; resumes on subgraph terminal (FR-22).
4. CONFIRMING UI exposes Accept all / Reject all / Apply selected, plus per-finding toggles, plus per-schema-patch confirm (FR-37).
5. Schema patches never auto-apply; explicit confirm gate (FR-37).
6. WRITING applies only accepted patches; appends one `log.md` entry with counts (FR-38).
7. Terminal DONE returns the documented shape (FR-39).
8. `/wiki-lint` slash entry visible in picker; selecting it invokes the tool with default args (FR-52).
9. Storybook covers idle / scanning / checking / proposing / confirming-empty / confirming-multi / confirming-with-schema-drift / writing / done / error variants.
10. Bundle delta: with F12 + F19 + dependencies merged, the slice fits within the ≤ 40 KB minified `main.js` budget (NFR-04). Verified via `pnpm check:bundle`.

## Dependencies

- F10 (writer reuse).
- F18 (lint subgraph + RunHandle).
- Anchors: [context.md `Lint Trigger & Confirmation`](../../context.md#lint-trigger--confirmation), [context.md `Lint Subgraph — Phases`](../../context.md#lint-subgraph--phases), [context.md `Slash Commands`](../../context.md#slash-commands).

## Implementation notes

- Tool registered as a built-in `ToolSpec` (`source:"builtin"`, `requiresConfirmation:true`) per [architecture.md §4](../../../../architecture/architecture.md#4-key-contracts); pattern mirrors `src/tools/builtin/delegateExternal.ts` per [project-structure.md](../../../../standards/project-structure.md).
- Confirmation flow rides the standard `tool_confirmation` stream-event path documented in [architecture.md §5.3](../../../../architecture/architecture.md#53-chat-turn-with-tool-call--confirmation), via `confirmationController` at `src/agent/confirmationController.ts` per [project-structure.md](../../../../standards/project-structure.md). Per-schema-patch confirms reuse the same surface.
- Tool result shape `{ ok:true, data }` / `{ ok:false, error|cancelled|denied|busy }` per [architecture.md §4](../../../../architecture/architecture.md#4-key-contracts) `ToolResult` and [code-style.md `LangGraph / Agent Layer`](../../../../standards/code-style.md).
- Multi-select finding list co-located under `src/agent/wiki/widget/` per [project-structure.md](../../../../standards/project-structure.md); UI imports the controller (no back-edge per [architecture.md §1](../../../../architecture/architecture.md#1-architectural-principles)).
- Slash command registration at `src/ui/chat/slashCommands.ts` per [project-structure.md](../../../../standards/project-structure.md); slash invokes the tool with default args — UI never drives the subgraph directly.
- Bundle baseline guard `pnpm check:bundle` per [project-structure.md `Test suites`](../../../../standards/project-structure.md).

## Open questions

- OQ-5 — diff-render `SCHEMA.md` patches in widget; recommend yes from day one if cheap, per [context.md `Open questions`](../../context.md#open-questions).
