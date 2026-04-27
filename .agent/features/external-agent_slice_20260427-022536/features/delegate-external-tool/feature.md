# F06 — `delegate_external` trigger tool

## Purpose

Provide the entry point the main agent calls when no other tool fits: a built-in tool with a confirmation gate (Prepare / Deny), a busy-slot guard, and suspended-tool semantics that resume only when the subgraph reaches a terminal state.

Implements [`context.md`](../../context.md) FR-EXT-01, FR-EXT-02, FR-EXT-03, FR-EXT-04, FR-EXT-06.

## Scope

**In scope**
- `src/tools/builtin/delegateExternal.ts`: `ToolSpec` with `id='delegate_external'`, `requiresConfirmation: true`, Zod input schema `{ ask: string }` (≤ 16 KB) plus a `description` instructing the model on when to escalate.
- Custom confirmation surface: action labels `"Prepare external agent request"` and `"Deny"` instead of the default Allow/Deny — the existing `confirmationController` already supports arbitrary labels per architecture; F06 wires the labels and decision mapping.
- Tool invocation flow:
  1. Confirmation prompt fires.
  2. **Deny** → tool returns `{ ok:false, denied:true }` immediately; main agent resumes.
  3. **Prepare** → tool calls subgraph slot manager (F03) with `{ threadId, originalAsk, runId }`.
     - On `'busy'` → tool returns `{ ok:false, error:'busy', activeRunId }` immediately.
     - On acquire → tool **suspends** (returns a Promise that resolves on subgraph terminal state); when subgraph completes, tool returns the terminal payload from F05 (`run-phase` §AC-10).
- Registration into `ToolRegistry` at plugin load.
- Integration tests using a stub subgraph: deny path, busy path, prepare→DONE path, prepare→CANCELLED path, prepare→ERROR path. Each asserts the resulting `tool_result` payload shape and that `confirmationController` records the user decision in the thread allowlist correctly (or, more importantly, does NOT auto-allow further `delegate_external` calls — every escalation must re-prompt; see AC-4).

**Out of scope**
- The widget render and its actions (F08).
- The subgraph internals (F03, F04, F05).
- Settings UI (F11).

## Acceptance criteria

1. `delegate_external` is registered in `ToolRegistry` at plugin load and appears in `ToolRegistry.listFor(thread)` for every thread (no Skill `allowedTools` exclusion needed by default).
2. Tool description, in plain prose readable by the LLM: instructs use *only* when no other registered tool fits AND the task plausibly benefits from an external system (research, web access, third-party agent, long-running computation). Honors FR-EXT-01.
3. Confirmation surface shows two buttons with labels `"Prepare external agent request"` and `"Deny"`. Honors FR-EXT-02.
4. **Per-call confirmation only** — `delegate_external` MUST NOT support "Allow for thread" persistence. Each escalation re-prompts. (Differs from the default tool-confirm pattern; rationale: external agents have material side effects.) Implementation: tool sets a flag on `confirmationController` request to suppress the persistence option.
5. Deny → tool resolves with `{ ok:false, denied:true }` within the confirmation interaction; no subgraph started. Honors FR-EXT-03.
6. Prepare path:
   - `slotManager.acquire(threadId)` → `'busy'`: tool resolves immediately with `{ ok:false, error:'busy', activeRunId }`. Honors FR-EXT-06.
   - On acquire: tool registers a one-shot listener for the subgraph's terminal event and returns its Promise. Honors FR-EXT-04 (suspended-tool semantics).
7. Tool returns the *exact* payload shape produced by F05's `terminal` node — no remapping in F06.
8. Tool input schema rejects `ask` strings > 16 KB or empty/whitespace-only with a typed Zod error parsed at the boundary, surfaced as `{ok:false, error:'invalid_input', message}`. Honors hard-limit from F04 §OQ-03 (parallel constraint on the entry point).

## Dependencies

- **F03** — slot manager + subgraph entry function; `runId` allocation.
- **F04 / F05** — ultimately produce the terminal payload F06 forwards (already specified; F06 doesn't depend on their internals, only on the `terminal` event contract).
- Cross-doc:
  - [`context.md#fr-ext-01`](../../context.md#functional-requirements)
  - [`../subgraph-state-machine/feature.md`](../subgraph-state-machine/feature.md)
  - [`../run-phase/feature.md`](../run-phase/feature.md)

## Implementation notes

- ToolSpec shape — see existing `ToolSpec` interface in [`.agent/architecture/architecture.md`](../../../../architecture/architecture.md) §4 and `src/tools/types.ts`.
- Confirmation flow — exact pattern in [`.agent/architecture/architecture.md`](../../../../architecture/architecture.md) §5.3 (Chat Turn with tool call + confirmation); custom labels exposed by `src/agent/confirmationController.ts`.
- Tool registration — registry lookup pattern from [`.agent/architecture/architecture.md`](../../../../architecture/architecture.md) §3.2 ("Registry pattern for tools").
- Per-call confirmation override — current allowlist behavior described in [`.agent/architecture/architecture.md`](../../../../architecture/architecture.md) §3.1 (per-thread allowlist); F06 *opts out* of allowlist persistence; verify the existing controller exposes a flag, otherwise extend its options object (small additive change, document under §Open questions).
- Result type — `{ ok:true, data } | { ok:false, error }` per [`.agent/standards/code-style.md`](../../../../standards/code-style.md) §"LangGraph / Agent Layer".

## Open questions

- **OQ-01-F06** Does `confirmationController` already expose `disableAllowForThread: boolean`? If not, this is a small upstream extension — needs to land in the same PR slice. **Proposed**: extend the request options additively; default `false` to preserve existing tools' UX.
- **OQ-02-F06** Tool description wording impacts model behavior; should it list example "good" triggers (e.g. "use this for web search, deep research, calling an external CLI agent")? **Proposed**: yes — short bulleted list, ≤ 6 examples; tested via live LLM in `tests/llm/toolCalling.live.test.ts`.
- **OQ-03-F06** Should the tool `description` mention that the user must approve every call? Could nudge the model toward asking the user first in chat instead of auto-emitting the tool call. **Proposed**: yes — one sentence; reduces wasted confirmation prompts.
