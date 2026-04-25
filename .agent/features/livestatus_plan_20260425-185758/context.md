# Context — Live Agent Status (livestatus.md) ⨉ Leo repo

Source SRS: [`.agent/srs/livestatus.md`](../../srs/livestatus.md). Repo standards consulted: [`tech-stack.md`](../../standards/tech-stack.md), [`code-style.md`](../../standards/code-style.md), [`project-structure.md`](../../standards/project-structure.md), [`architecture.md`](../../architecture/architecture.md).

The SRS targets a generic re-implementation. This context narrows it to *what aligns with Leo's existing codebase* and *what new surfaces Leo must add*. Out-of-alignment requirements are listed under "Out of scope".

## Scope

Live, in-flight rendering of an LLM agent's transcript inside `ChatView`, modeled on Claude Code's renderer:

- Streaming aggregator that grows a typed `AssistantMessage` content array per provider stream.
- Run-state store tracking per-tool-use lifecycle (queued / running / resolved / errored / rejected / canceled).
- Per-block React renderers for: text, thinking, tool-use, tool-result, sub-agent progress, system banners.
- Inline tool-use UI: status glyph + blink, args, progress lines, result panel, permission prompt.
- Bottom-of-chat live indicator with stalled detection and Esc-abort.
- Grouping of adjacent resolved read-only tool calls.
- Tool-specific renderers (file edit diff).
- Persistence/replay of typed blocks; canceled-on-resume for unresolved tool uses.
- Storybook stories per renderer with shared mocks; obsidian-var-themed preview.

## Out of scope

- Adopting Anthropic-API content-block schema verbatim across the wire — Leo's provider abstraction stays. Mapping happens at the aggregator boundary (`StreamingTurnController`).
- Generic `redacted_thinking` opaque payloads — Leo's LM Studio + OpenAI-compatible providers do not currently emit them. Plan a stub renderer; do not wire encryption flow.
- Auth, session management, transcript persistence schemas, model selection, cost tracking (already exist in repo, untouched here).
- Specific tool implementations (bash sandboxing, file edit semantics) — only how their *progress and results* surface in chat.
- Web/terminal renderer parity — Leo runs only inside Obsidian (Electron renderer). Style cheatsheet adapted to Obsidian CSS vars.
- React-Compiler `_c(n)` auto-memo — Leo does not use the React Compiler. Use `useMemo` / `React.memo`.
- Migrating `data.json` plugin settings — typed-block migration is scoped to `.leo/conversations/*.json`.

## Actors

- **Plugin user** — reads/writes notes, fires chat turns, approves/denies tool calls, cancels runs.
- **LangGraph agent loop** (`AgentRunner` + `graph.ts`) — emits provider stream events + tool calls + results; pauses on `interrupt()` for confirmation.
- **Tool runner** (built-in tools, user tools, MCP tools via `ToolRegistry`) — executes tools, emits progress events (new), returns `ToolResult`.
- **Provider** (`LMStudioProvider`, `AnthropicProvider`, `openAICompatibleProvider`) — produces token stream + tool calls + usage.
- **Sub-agent runner** (LangGraph child invocations) — phase-2 emit `agent`-kind progress.
- **MCP servers** — emit tool progress notifications.
- **Storybook reader / contributor** — exercises every renderer permutation in isolation.

## Functional requirements

- **FR-01 — Tagged-union message content.** `ChatMessageRecord` carries a typed `content` array of `text | thinking | tool_use | tool_result` blocks instead of a single `content: string`. Order preserved by index.
- **FR-02 — Stream aggregator emits typed blocks.** `StreamingTurnController` consumes `content_block_start` / `content_block_delta` / `content_block_stop` semantics (mapped from provider events) and grows the active `AssistantMessage.content[index]` accordingly.
- **FR-03 — Tool-use input streams as JSON.** Per-block `input_json_delta` accumulates into a string buffer; parsed on `content_block_stop`; on parse failure block carries `{ __raw: string }`.
- **FR-04 — Run-state store.** Per-thread store maintains `inProgressToolUseIds`, `resolvedToolUseIds`, `erroredToolUseIds`, `rejectedToolUseIds`, `canceledToolUseIds`, `progressByToolUseId`, `permissionRequests`. Store updates only via mutators called from agent runner / tool runner.
- **FR-05 — `statusOf(id)` derivation.** Pure function reading run-state store + tool-use block → `'queued' | 'running' | 'success' | 'errored' | 'rejected' | 'canceled'`.
- **FR-06 — Per-block renderers.** Renderers exist for: assistant text, thinking, tool-use, tool-result, sub-agent progress, system/error/rate-limit banners.
- **FR-07 — Streaming text cursor.** Soft cursor on the *last* content block of an assistant message whose status is `streaming`.
- **FR-08 — Tool-use status glyph + blink.** `●` colored by status. While `running`, blinks at ~2 Hz via space-swap (`useBlink` hook).
- **FR-09 — Tool-use args.** Default: collapsed JSON one-liner of parsed input, truncated. Tools may opt into custom renderer via registry.
- **FR-10 — Inline permission prompt.** When tool requires confirmation, prompt renders inline *above* the tool's args region. User decision mutates run-state and resumes graph; decision persists for replay.
- **FR-11 — Tool result panel.** Mounts under its tool-use block (lookup by `tool_use_id`). Per status: success (collapsed monospace), errored (red, full), rejected (gray, reason), canceled (gray strikethrough), success-with-diff (file-edit tools).
- **FR-12 — Thinking block renderer.** Italic, dim, bordered, "Thinking" label. Collapsed when finalised, expanded while streaming. `redacted_thinking` shows only `Redacted thinking · (n bytes)`.
- **FR-13 — Progress events.** New `StreamEvent` variant `progress` carries `ProgressEvent` (kinds: `bash`, `web_search`, `task_output`, `mcp`, `agent`, `skill`). Stored in `progressByToolUseId`. Rendered ephemeral under tool-use; never persisted.
- **FR-14 — Sub-agent tree.** `agent`-kind progress aggregates per `agentId` and renders a tree under the launching tool-use: agentType · tools · tokens · lastToolInfo. Tree connectors `└─` / `├─`. Updates in place.
- **FR-15 — Grouping of read-only tool-uses.** Adjacent tool-use blocks in the *same* assistant message that all resolved successfully and target the same read-only tool collapse into a single expandable summary. Never group running/errored/rejected.
- **FR-16 — Tool-specific result renderers.** `editNote` / `createNote` / `appendToNote` render unified diff (additions/removals, syntax-highlighted). Other tools fall back to default monospace.
- **FR-17 — Bottom-of-chat live indicator.** Persistent line below `MessageList`. Shows `Running <toolName> · <elapsed>` when any tool runs; `Thinking…` while text streaming; `Reasoning…` while thinking streaming; hidden when idle. Stalled detection: after 10 s no event, switch to `Working… (no output for {n}s)`. Esc → cancel.
- **FR-18 — Persistence of typed blocks.** `ConversationStore` persists `content[]` blocks alongside legacy fields. Loader migrates legacy `content: string` into `[{ type: 'text', text }]`.
- **FR-19 — Replay marks unresolved canceled.** On thread load, every tool-use without a paired tool-result becomes `status='canceled'`. Run-state store starts empty; `statusOf` still works because each tool-use either has a result or a canceled marker.
- **FR-20 — Storybook coverage.** Every public renderer ships a `*.stories.tsx` file with stable mocks. Mocks live under `src/ui/chat/__stories__/mocks/` and are reusable across stories.

## Non-functional requirements

- **NFR-01 — Bundle.** No new heavy dep. Diff renderer uses tiny inline algorithm (Myers or `diff` ≤ 30 KB). Stay under bundle budget (<1.5 MB main.js per [`tech-stack.md`](../../standards/tech-stack.md)).
- **NFR-02 — Streaming throughput.** Coalesce delta updates with `requestAnimationFrame`. No more than one re-render of `MessageList` per frame regardless of token rate.
- **NFR-03 — Run-state store separated.** `runStateStore` lives outside `ChatMessageStore`. Tool-use status changes do not re-render unrelated messages. Renderers subscribe via `useSyncExternalStore` to per-id selectors.
- **NFR-04 — Memoization.** Per-block renderers wrapped in `React.memo`. `useMemo`/`useCallback` per [`code-style.md`](../../standards/code-style.md).
- **NFR-05 — Accessibility.** Status glyph carries `aria-label` (e.g. "running", "succeeded"). Permission prompt is `role=dialog` `aria-modal=true`. Live indicator is `role=status` `aria-live=polite`.
- **NFR-06 — Theming.** All colors via Obsidian CSS vars (`var(--color-green)`, `var(--color-red)`, etc.). No hard-coded hex.
- **NFR-07 — Determinism.** No `Date.now()` reads in renderers — clock injected for tests/Storybook.
- **NFR-08 — Test coverage.** Vitest unit tests for: aggregator state machine, run-state mutators, `statusOf`, group-detection logic, diff parser. DOM tests under `tests/dom/` for renderers.
- **NFR-09 — Pure core.** Aggregator, run-state mutators, group detector, diff parser are pure modules ([`architecture.md` §1](../../architecture/architecture.md#1-architectural-principles), [`best-practices.md`](../../standards/best-practices.md)).
- **NFR-10 — Observable.** `Logger` events at: aggregator parse failure, run-state mutator denials, stalled-detector trigger, tool-use group collapse.
- **NFR-11 — Cancellation safety.** `Esc` from live indicator wires to `streamingController.stop()` *and* marks all `inProgressToolUseIds` canceled in run-state store.
- **NFR-12 — Edit-lock release.** Permission denial / cancellation never leaves an `EditorBridge` lock held — preserved by existing try/finally in `withLock`.
- **NFR-13 — Storybook isolation.** Stories must run with `obsidian` mocked, no LangGraph import in component path. Existing aliases in [`.storybook/main.ts`](../../../.storybook/main.ts) cover this.

## Constraints

- TypeScript strict mode. No `any`, no `enum`, no default exports — per [`code-style.md`](../../standards/code-style.md).
- React 18 function components. Hooks order locked. Cleanup mandatory — per [`code-style.md`](../../standards/code-style.md#react-18).
- Layered deps UI → Agent → Domain → Adapters → Platform (no back-edges) — per [`architecture.md` §2](../../architecture/architecture.md#2-layer-diagram).
- Provider abstraction stays — aggregator is a *boundary normalizer*, not a wire-format change.
- LangGraph `interrupt()` pattern is the only confirmation channel — no ad-hoc event buses ([`architecture.md` §1](../../architecture/architecture.md#1-architectural-principles)).
- IndexedDB conversation schema versioned; migration in `upgrade()` callback — per [`code-style.md`](../../standards/code-style.md#indexeddb-idb).
- Storybook stories colocated next to component; shared mocks under `src/ui/chat/__stories__/mocks/` — per existing convention in [`project-structure.md`](../../standards/project-structure.md).

## Glossary

- **Content block** — a typed entry in `AssistantMessage.content[]`. One of `text | thinking | tool_use | tool_result`.
- **Tool-use block** — a content block of `type: 'tool_use'` with `id`, `name`, `input`. Renders as a header line + args + progress + result panel.
- **Tool-result block** — a content block of `type: 'tool_result'` (technically lives under a `UserMessage` per Anthropic schema). Looked up by `tool_use_id` and rendered attached to its tool-use.
- **Run state** — per-tool-use lifecycle state separate from message content. Mutated by agent runner / tool runner; read by renderers.
- **Progress event** — ephemeral event under a running tool-use. Not persisted.
- **Permission prompt** — inline dialog asking the user to allow/deny a tool. Resolves to `allow-once | allow-thread | deny`.
- **Sub-agent** — a child LangGraph invocation triggered by a parent tool. Surfaces via `agent`-kind progress.
- **Status glyph** — `●` rendered with status-specific color/animation. Width-stable (space-swap blink).
- **Stalled** — no stream event for >10 s. Triggers a label change in the live indicator.

## Open questions

- **OQ-01** Should typed-block migration of legacy persisted conversations happen lazily (on load) or eagerly (one-time pass)? Default plan: lazy with idempotent shim. Raise if conversation count >10k.
- **OQ-02** Provider mapping for thinking deltas: Anthropic emits `thinking_delta`; OpenAI-compatible providers expose reasoning content via different shapes. Need a per-provider adapter — defer to F02 implementation.
- **OQ-03** Live indicator's `Esc` shortcut may collide with Obsidian-native handlers when ChatView lacks focus. Need to scope keyboard listener to chat root + a fallback toolbar Stop button.
- **OQ-04** Should sub-agent progress aggregate by `parentToolUseId` (graph-derived) or by emission order? SRS uses parent linkage. Confirm `LangGraph` exposes parent ID on child stream events.
- **OQ-05** Diff renderer for `editNote` needs the original content snapshot — currently the tool only returns `bytesWritten` + `undo`. Decide whether the tool result includes pre/post strings, or whether the renderer reads vault file by path. Vault read introduces async — favors enriching `ToolResult.data`.
- **OQ-06** Storybook clock injection: prefer `clock` prop on every renderer or a single Storybook `decorators[]` time provider? Defer to F14.
