# F52 — MCP tool confirmation · UI

This feature adds NO new UI surface. It extends the [F17 tool-confirmation-flow](../tool-confirmation-flow/feature.md) `InlineConfirmation` region with MCP-specific labelling (generic MCP icon, `<serverName>: <toolName>` friendly title, fully-namespaced `mcp.<serverId>.<toolName>` id surfaced in the args-preview header) and the registration-time `requiresConfirmation = true` default at [F51 mcp-client-config-transports](../mcp-client-config-transports/feature.md)'s `ToolSpec` builder step. Three ASCII wireframes follow — two dialog variants plus a FORBIDDEN panel pinning what this feature must NOT add.

## Layout

### Wireframe 1 — First-call MCP confirmation dialog (reuses F17 inline region)

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|   min-width marker: 280 px
+--------------------------------------------------+
| ...transcript bubbles above (from F05)...        |
+--------------------------------------------------+
|  InlineConfirmation region (from F04)            |
| ┌══════════════════════════════════════════════┐ |   <- amber header band
| │ [🔌] github: create_issue                    │ |      var(--color-orange)
| │      External MCP tool — first call in this  │ |      (awaiting-confirmation
| │      thread. This will call an MCP server.   │ |       palette from F13)
| │                                              │ |
| │  mcp.github.create_issue                     │ |   <- namespaced id header
| │                                              │ |      (args-preview header)
| │ ┌──────────────────────────────────────────┐ │ |
| │ │ {                                        │ │ |
| │ │   "title": "Bug: race in store",         │ │ |   <- pre block
| │ │   "body": "Reproduces on reload…"        │ │ |      monospace, white-space:pre
| │ │ }                                        │ │ |      pretty-printed JSON
| │ └──────────────────────────────────────────┘ │ |
| │                                              │ |
| │  [ Allow once ] [ Allow for thread ] [Deny] │ |   <- action row
| └══════════════════════════════════════════════┘ |      order identical to F17
+--------------------------------------------------+
| ...composer below (from F06)...                  |
+--------------------------------------------------+

dialog anchor   : [F17 InlineConfirmation](../tool-confirmation-flow/ui.md) region — NEVER a
                  native Obsidian Modal per [FR-UI-08](../../context.md#fr-ui-08)
role/ARIA       : role="dialog" aria-modal="true" aria-live="assertive"
                  aria-labelledby → header title element id
                  aria-describedby → args <pre> element id
icon            : setIcon(iconEl, "plug")  // generic MCP icon from
                  [F13 iconFor registry](../ui-visual-states-notifications/feature.md)
                  per [FR-UI-05](../../context.md#fr-ui-05) — NEVER the server-provided icon
title (friendly): "<serverName>: <toolName>"   (e.g. "github: create_issue")
                  serverName resolved from config entry; never the raw
                  mcp.<serverId>.<toolName> id in the title
subtitle        : "External MCP tool — first call in this thread."
                  plus the vault-risk copy if the tool is a write-kind
namespaced id   : rendered as a small mono label above the args <pre>;
                  this is the EXACT key stored in
                  thread.metadata.allowedTools on Allow-for-thread
header tint     : var(--color-orange) border — amber 'awaiting-confirmation'
                  palette from [F13](../ui-visual-states-notifications/feature.md)
                  per [FR-UI-06](../../context.md#fr-ui-06) — MCP is treated like
                  a write-kind tool: external / network-egress-risk
button order    : [Allow once] → [Allow for thread] → [Deny]
                  DOM + Tab order matches visual order (muscle memory
                  invariant inherited from F17 AC4)
focus           : on mount → primary button [Allow once]
                  focus trap inside the three buttons until resolve
data-visual-state : "awaiting-confirmation"
data-tool-source  : "mcp"            // new data attribute — lets Vitest snapshot
                                     // assert MCP vs builtin rendering
data-tool-kind    : "mcp.external"   // distinct from "read" / "write" for
                                     // styling + a11y / SR phrasing
```

Args are pretty-printed with `JSON.stringify(args, null, 2)` in the same `<pre>` block F17 uses; no MCP-specific truncation beyond F17's existing soft cap. Zero colour literals — all tint resolves through Obsidian CSS variables per [Code style → Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian).

### Wireframe 2 — Pre-approved bypass variant (no dialog; tool runs directly)

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|
+--------------------------------------------------+
| ...transcript bubbles above (from F05)...        |
+--------------------------------------------------+
|  MessageList tail (from F05)                     |
| ┌──────────────────────────────────────────────┐ |
| │ tool · github: create_issue                  │ |   <- tool-running bubble
| │   ⟳  invoking mcp.github.create_issue        │ |      data-visual-state
| │                                              │ |         = "tool-running"
| │      (pre-approved for this thread)          │ |      from [F13](../ui-visual-states-notifications/feature.md)
| └──────────────────────────────────────────────┘ |
+--------------------------------------------------+
| InlineConfirmation region: (empty, unmounted)    |   <- NO dialog shown at all
+--------------------------------------------------+

pre-approval   : thread.metadata.allowedTools includes
                 "mcp.github.create_issue" from a prior
                 "Allow for thread" resolution (AC3 of feature.md)
gate           : [F17](../tool-confirmation-flow/feature.md) pre-invoke gate hit
                 BEFORE LangGraph interrupt() is reached — tool
                 invocation proceeds directly per AC6 of feature.md
dialog mount   : NEVER — a Vitest assertion verifies the dialog does not
                 mount on pre-approved calls (AC3 of feature.md)
bubble         : standard F13 tool-running surface; the "(pre-approved for
                 this thread)" suffix is an F13-owned caption — this feature
                 does not introduce a new visual element
new-thread     : on a freshly-created thread, the same tool id is NOT in
                 allowedTools (fresh thread allowedTools: [] per F14) and
                 Wireframe 1 fires again (AC6 of feature.md)
```

The bypass variant is the ordinary F13 `tool-running` bubble — this feature deliberately adds no new UI surface for pre-approved calls. The `(pre-approved for this thread)` suffix is a caption F13 already renders for allowlisted tools; MCP tools inherit it unchanged.

### Wireframe 3 — FORBIDDEN surfaces (what this feature must NOT add)

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|
+--------------------------------------------------+
|  FORBIDDEN — NONE of the following are permitted |
+--------------------------------------------------+
|                                                  |
|  ❌  No native Obsidian Modal for MCP confirmations│
|        (reuses F17 inline region only per         |
|         [FR-UI-08](../../context.md#fr-ui-08))   |
|                                                  |
|  ❌  No "Trust this server" bulk-allow button     |
|        (out of scope per feature.md — every MCP   |
|         tool is individually gated per            |
|         [FR-MCP-07](../../context.md#fr-mcp-07))  |
|                                                  |
|  ❌  No new confirmation action beyond the three  |
|        F17 actions — no "Deny forever",           |
|        no "Deny for thread", no "Always ask"     |
|                                                  |
|  ❌  No per-server palette / new visual state —   |
|        MCP tools use the same amber                |
|        'awaiting-confirmation' palette from F13   |
|                                                  |
|  ❌  No server-supplied custom icon in the title  |
|        (always the generic "plug" MCP icon per    |
|         [FR-UI-05](../../context.md#fr-ui-05) —   |
|         servers cannot brand the dialog)          |
|                                                  |
|  ❌  No tool-argument content in logs above debug │
|        (mcp.tool.confirmation.default carries     |
|         only {toolId, serverId})                  |
|                                                  |
|  ❌  No new thread.metadata field — reuses the    |
|        existing allowedTools: string[] array      |
|        owned by [F14](../conversation-persistence-v1/feature.md) |
|                                                  |
+--------------------------------------------------+

rationale      : single source of truth — dialog + state machine + Esc=Deny +
                 allowlist shape + tool-error synthesis all live in F17/F14
                 and are reused byte-identically for MCP tools per
                 feature.md scope; this feature contributes only the
                 registration-time default flip and the MCP-specific
                 labelling, nothing else
asserted by    : Vitest per [NFR-TEST-01](../../context.md#nfr-test-01)
                 and [NFR-TEST-05](../../context.md#nfr-test-05) —
                 Modal-constructor-never-invoked spy, single-icon-family
                 snapshot, allowedTools stays string[], log event schema
                 excludes args
```

The FORBIDDEN panel exists to pin the non-goal boundary: this is a **default flip + label mapping**, not a new UI slice. Verifier must spy on `Modal`, confirm no new `data-visual-state`, and assert the allowlist shape is unchanged.

## State machine

MCP tools reuse [F17's `ConfirmationLifecycleMachine` and `FocusTrapMachine`](../tool-confirmation-flow/ui.md) byte-identically. The only MCP-specific state graph is the **pre-approval gate decision** that runs before F17 is ever entered.

### `McpPreApprovalGateMachine` (per tool call)

```mermaid
stateDiagram-v2
    [*] --> inspectingCall
    inspectingCall --> lookupRegistry : tool_call received
    lookupRegistry --> notMcp : ToolSpec.source != "mcp"
    lookupRegistry --> mcpFound : ToolSpec.source == "mcp"
    notMcp --> [*] : delegate to F17 default gate

    mcpFound --> checkAllowlist : inspect thread.metadata.allowedTools
    checkAllowlist --> preApproved : allowedTools.includes("mcp.<serverId>.<toolName>")
    checkAllowlist --> firstCall   : NOT included

    preApproved --> [*] : bypass dialog, invoke tool directly
                        : bubble goes straight to tool-running (F13)

    firstCall --> enteringF17 : mount F17 InlineConfirmation
                              : pass MCP labels + icon
    enteringF17 --> [*] : F17 ConfirmationLifecycleMachine takes over
                        : (awaiting → resolved → resumed/aborted)
```

Adjacency-list equivalent:

- `[*] → inspectingCall` on `StreamEvent.tool_call{ toolId, args }` from [F10 AgentRunner](../agent-controller-core/feature.md).
- `inspectingCall → lookupRegistry` — synchronous call `ToolRegistry.lookup(toolId)` from [F16 tool-registry-builtin-read](../tool-registry-builtin-read/feature.md); the returned `ToolSpec.source` is the key discriminator.
- `lookupRegistry → notMcp` — when `ToolSpec.source !== "mcp"` this machine exits; F17's default gate handles built-in tools via [FR-AGENT-10](../../context.md#fr-agent-10) read/write rule and does so unchanged.
- `lookupRegistry → mcpFound` — when `ToolSpec.source === "mcp"`, `ToolSpec.requiresConfirmation === true` is an invariant (AC1 of [feature.md](./feature.md)) set at [F51](../mcp-client-config-transports/feature.md)'s spec-builder step.
- `mcpFound → checkAllowlist` — the F17 pre-invoke gate queries `thread.metadata.allowedTools.includes(toolId)` from [F14 conversation-persistence-v1](../conversation-persistence-v1/feature.md) with the full namespaced id `mcp.<serverId>.<toolName>`.
- `checkAllowlist → preApproved` — match → `[*]`; `McpPreApprovalGateMachine` exits without mounting a dialog, LangGraph `interrupt()` is NOT invoked, tool proceeds to execute; the `tool-running` bubble from [F13](../ui-visual-states-notifications/feature.md) renders with a `(pre-approved for this thread)` caption (AC3 of feature.md).
- `checkAllowlist → firstCall` — no match → enter F17 flow; LangGraph `interrupt({call})` pauses the graph; `StreamEvent.tool_confirmation{call, resolve}` is emitted per [Architecture §5.3](../../../../architecture/architecture.md#53-chat-turn-with-tool-call--confirmation).
- `firstCall → enteringF17` — control handed to F17's [`ConfirmationLifecycleMachine`](../tool-confirmation-flow/ui.md) with MCP-specific rendering data `{ displayTitle: "<serverName>: <toolName>", icon: "plug", namespacedId: "mcp.<serverId>.<toolName>", source: "mcp" }`.
- `enteringF17 → [*]` — F17's state machine runs to terminal (`resumed` on Allow once / Allow for thread, `aborted` on Deny); on `resolved(allow-thread)` F17 writes the namespaced id into `thread.metadata.allowedTools` via `ConversationStore.mutate` (AC3 of feature.md); future calls of the same id in this thread short-circuit at `checkAllowlist → preApproved`.

Cross-thread / cross-server invariants:

- Fresh thread → `thread.metadata.allowedTools = []` (F14 default); first MCP call always lands in `firstCall` (AC6 of feature.md).
- Same tool name, different `serverId` (e.g. `mcp.a.read` vs `mcp.b.read`) → key mismatch → `firstCall` (AC6 of feature.md).
- Same `serverId` re-added after removal with same `toolName` → key matches → `preApproved` (intentional per feature.md scope "Server-rename resilience").

Teardown inherits F17's rule: pending `awaiting` on `ChatView.onClose` / `plugin.unload()` forcibly resolves with `{decision:"deny"}` per [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules); no MCP-specific hook added.

The machine is Vitest-unit-tested per [NFR-TEST-01](../../context.md#nfr-test-01) and [NFR-TEST-05](../../context.md#nfr-test-05); the `source === "mcp"` discriminator, the namespaced-id allowlist lookup, and the cross-server re-prompt are each covered by dedicated tests per AC8 of [feature.md](./feature.md).

## Event flow

### 0. MCP tool registration (plugin boot / server connect)

1. On `Plugin.onload` or a later MCP server connect, [F51](../mcp-client-config-transports/feature.md)'s `MCPClient` runs `tools/list` against the connected server and wraps each discovered tool into a `ToolSpec`.
2. At the `ToolSpec` builder step this feature stamps `spec.requiresConfirmation = true` unconditionally — regardless of any JSON-Schema hint on the server side — per [FR-MCP-07](../../context.md#fr-mcp-07) and [Architecture §4 Key Contracts](../../../../architecture/architecture.md#4-key-contracts).
3. `ToolRegistry.register(spec)` is called with `spec.id = "mcp.<serverId>.<toolName>"` and `spec.source = "mcp"` per [FR-MCP-06](../../context.md#fr-mcp-06).
4. Structured log event `mcp.tool.confirmation.default { toolId, serverId }` at `debug` via the [F01 Logger](../plugin-bootstrap-logging/feature.md) — fired once per MCP tool registration; never carries argument or JSON-Schema payloads (AC8 of [feature.md](./feature.md)).
5. No UI change at this step — the bubble surface only appears when the tool is actually invoked.

### 1. First MCP tool call in a thread → dialog mounts

1. Turn loop in [F10 `AgentRunner`](../agent-controller-core/feature.md) receives a `tool_call` from the provider stream carrying `toolId = "mcp.<serverId>.<toolName>"`.
2. `ToolRegistry.lookup(toolId)` from [F16](../tool-registry-builtin-read/feature.md) returns `ToolSpec{ source: "mcp", requiresConfirmation: true }`.
3. F17's pre-invoke gate (`McpPreApprovalGateMachine.checkAllowlist`) evaluates `thread.metadata.allowedTools.includes(toolId)` — on a fresh/first-call thread this is `false`, so the gate falls through to `firstCall`.
4. LangGraph [`interrupt({call})`](../../../../standards/tech-stack.md#agent--tool--skill--mcp-wiring) pauses the graph; pending state surfaces as [`StreamEvent.tool_confirmation{call, resolve}`](../../../../architecture/architecture.md#4-key-contracts) per [Architecture §5.3](../../../../architecture/architecture.md#53-chat-turn-with-tool-call--confirmation) and [Architecture §5.5 MCP Tool Call](../../../../architecture/architecture.md#55-mcp-tool-call).
5. `ChatView` mounts the F17 inline dialog in the `InlineConfirmation` region from [F04 chat-sidebar-view](../chat-sidebar-view/feature.md), passing MCP-specific render data:
   - `displayTitle = "<serverName>: <toolName>"` — resolved from the config entry's `serverName` (human label) and the tool's local name; never raw `mcp.<serverId>.<toolName>` in the title per [FR-UI-05](../../context.md#fr-ui-05).
   - `icon = "plug"` — generic MCP icon via [`setIcon(iconEl, "plug")`](../../../../standards/tech-stack.md#platform-apis) from the [F13 iconFor registry](../ui-visual-states-notifications/feature.md); never a server-supplied custom icon.
   - `namespacedId = "mcp.<serverId>.<toolName>"` rendered as the args-preview header label (small mono) so the user sees the exact key that will be persisted on Allow-for-thread.
   - `data-visual-state = "awaiting-confirmation"` and `data-tool-source = "mcp"` on the bubble root per [F13](../ui-visual-states-notifications/feature.md); amber palette per [FR-UI-06](../../context.md#fr-ui-06).
6. F17's `FocusTrapMachine.inactive → active`; focus moves to `[Allow once]`; SR announcement "Leo requests permission to use <serverName>: <toolName>" per [NFR-USE-08](../../context.md#nfr-use-08).
7. Structured log `tool.confirmation.request { toolId: "mcp.<serverId>.<toolName>", thread }` via [F01 Logger](../plugin-bootstrap-logging/feature.md) — F17's existing event, no new runtime event type added.

### 2. User clicks `[Allow once]`

1. F17's onClick handler calls `resolve({decision:"allow-once"})`.
2. Dialog unmounts; bubble transitions `awaiting-confirmation → tool-running` via [F13 VisualStateMachine](../ui-visual-states-notifications/feature.md).
3. `thread.metadata.allowedTools` is NOT mutated (AC4 of [feature.md](./feature.md)).
4. LangGraph resumes; `ToolRegistry.invoke(call)` dispatches to the MCP transport via F51; `tool_result` streams back normally per [Architecture §5.5](../../../../architecture/architecture.md#55-mcp-tool-call).
5. The next call of the same `mcp.<serverId>.<toolName>` in this same thread re-enters `firstCall` and re-prompts (AC4 of feature.md).
6. Structured log `tool.confirmation.allow-once { toolId, thread, decision:"allow-once" }` — F17's existing event.

### 3. User clicks `[Allow for thread]` — per-thread approval persisted

1. F17's onClick handler calls `ConversationStore.mutate(threadId, draft => { if (!draft.metadata.allowedTools.includes(toolId)) draft.metadata.allowedTools.push(toolId) })` from [F14 conversation-persistence-v1](../conversation-persistence-v1/feature.md). The pushed value is the full namespaced id `mcp.<serverId>.<toolName>` (AC3 of feature.md).
2. After `mutate` resolves, handler calls `resolve({decision:"allow-thread"})`.
3. Dialog unmounts; bubble transitions to `tool-running`; LangGraph resumes; tool invocation proceeds.
4. [F14](../conversation-persistence-v1/feature.md)'s debounced atomic write flushes the updated `allowedTools` array to thread JSON — survives plugin reload per AC3 of [feature.md](./feature.md).
5. Every subsequent call of the same `mcp.<serverId>.<toolName>` in this thread short-circuits at `McpPreApprovalGateMachine.checkAllowlist → preApproved` and invokes directly (Wireframe 2 above).
6. A fresh thread starts with `allowedTools = []`; cross-thread leakage is impossible by construction (AC6 of feature.md).
7. Structured log `tool.confirmation.allow-thread { toolId, thread, decision:"allow-thread" }` — F17's existing event.

### 4. User clicks `[Deny]` (or presses `Esc`)

1. F17's onClick handler (or Esc keydown in `FocusTrapMachine.active`) calls `resolve({decision:"deny"})`.
2. Dialog unmounts; NO mutation to `thread.metadata.allowedTools` (AC5 of feature.md).
3. The graph resumes in its error branch and synthesises `ToolResult{ok:false, error:"user denied mcp.<serverId>.<toolName>"}` per [Architecture §7 Error Handling Strategy](../../../../architecture/architecture.md#7-error-handling-strategy); typed `{ok, error}` shape per [Code style → LangGraph / Agent Layer](../../../../standards/code-style.md#langgraph--agent-layer).
4. Tool-error bubble renders via [F13 error state](../ui-visual-states-notifications/feature.md) reading `user denied mcp.<serverId>.<toolName>`; follow-up assistant message streams normally.
5. Structured log `tool.confirmation.deny { toolId, thread, decision:"deny" }` — F17's existing event.

### 5. Pre-approved subsequent call — no dialog

1. `tool_call` with `toolId = "mcp.<serverId>.<toolName>"` arrives.
2. `McpPreApprovalGateMachine.checkAllowlist` finds the id in `thread.metadata.allowedTools` (persisted in step 3 earlier).
3. LangGraph `interrupt()` is NOT invoked; the F17 dialog does NOT mount — asserted by a Vitest spy on the dialog mount effect (AC3 of feature.md).
4. `ToolRegistry.invoke(call)` runs directly; tool-running bubble from [F13](../ui-visual-states-notifications/feature.md) renders with the `(pre-approved for this thread)` caption (Wireframe 2).
5. No new log event for this path — F17's `tool.confirmation.*` events are only emitted when the dialog is actually reached; the routine `tool.invoke.*` events from [F10](../agent-controller-core/feature.md) carry the normal per-call trace.

### 6. Teardown

Inherits F17's teardown rule unchanged: on `ChatView.onClose` / thread switch / `plugin.unload()`, any pending `awaiting` MCP confirmation is forcibly resolved with `{decision:"deny"}` per [Architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules); no MCP-specific lifecycle hook added.

## Component mapping

| UI block | Component / API | Standards reference |
|---|---|---|
| Dialog container | **Reused** from [F17 `InlineConfirmationDialog`](../tool-confirmation-flow/ui.md) — React `<div role="dialog" aria-modal="true">` mounted into [F04](../chat-sidebar-view/feature.md)'s `InlineConfirmation` region; NEVER a native [Obsidian `Modal`](../../../../standards/tech-stack.md#platform-apis) per [FR-UI-08](../../context.md#fr-ui-08) | [Architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views); [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| Focus trap | **Reused** from [F17 `useFocusTrap`](../tool-confirmation-flow/ui.md) — Tab / Shift-Tab cycle across three buttons; Esc = Deny | [Code style → React 18](../../../../standards/code-style.md#react-18) |
| Icon | `setIcon(iconEl, "plug")` — generic MCP icon from the [F13 iconFor registry](../ui-visual-states-notifications/feature.md) per [FR-UI-05](../../context.md#fr-ui-05); MCP-specific mapping row added to F13's registry by this feature (the only new config-side entry) | [UI Layer → Icons](../../../../standards/tech-stack.md#ui-layer); [Platform APIs](../../../../standards/tech-stack.md#platform-apis) |
| Dialog title | `<h2 id={titleId}>{serverName}: {toolName}</h2>` — friendly label per [FR-UI-05](../../context.md#fr-ui-05); never the raw namespaced id | [Architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) |
| Namespaced-id header | Small mono label `<code>mcp.<serverId>.<toolName></code>` above the args `<pre>` — surfaces the exact key persisted on Allow-for-thread (resolves the open question in [feature.md](./feature.md) about where the fully-namespaced id appears) | [Architecture §4 Key Contracts](../../../../architecture/architecture.md#4-key-contracts) |
| Pretty-printed args | **Reused** from [F17](../tool-confirmation-flow/ui.md) — `<pre>` with `JSON.stringify(args, null, 2)`, F17's soft cap applies | [Code style → React 18](../../../../standards/code-style.md#react-18) |
| Buttons `[Allow once] [Allow for thread] [Deny]` | **Reused** from [F17](../tool-confirmation-flow/ui.md) byte-identically — same DOM order, same Tab order, same `data-action` attributes, same primary/secondary/danger accents | [Code style → Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| Header tint | `var(--color-orange)` — amber `awaiting-confirmation` palette from [F13](../ui-visual-states-notifications/feature.md) per [FR-UI-06](../../context.md#fr-ui-06); MCP tools treated like write-kind (network egress / external risk), no separate MCP palette | [UI Layer → Styling](../../../../standards/tech-stack.md#ui-layer); [Code style → Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) |
| `data-visual-state` attr | `"awaiting-confirmation"` — reused from [F13](../ui-visual-states-notifications/feature.md) unchanged | [Architecture §4 Key Contracts](../../../../architecture/architecture.md#4-key-contracts) |
| `data-tool-source` attr | New attribute `"mcp"` on the bubble root — lets Vitest snapshot distinguish MCP vs built-in dialogs without parsing the title; sole structural addition | [Code style → TypeScript](../../../../standards/code-style.md#typescript) |
| `data-tool-kind` attr | `"mcp.external"` — sibling to F17's `"read"` / `"write"` values; drives the subtitle copy ("External MCP tool…") and stays distinct from built-in categories | [Code style → TypeScript](../../../../standards/code-style.md#typescript) |
| Registration-time default flip | [F51](../mcp-client-config-transports/feature.md)'s `ToolSpec` builder step — one-line `spec.requiresConfirmation = true` unconditionally before `ToolRegistry.register(spec)` per [FR-MCP-07](../../context.md#fr-mcp-07) and [Architecture §4](../../../../architecture/architecture.md#4-key-contracts) | [Agent / Tool / Skill / MCP Wiring](../../../../standards/tech-stack.md#agent--tool--skill--mcp-wiring) |
| Pre-approval lookup | **Reused** from [F17 pre-invoke gate](../tool-confirmation-flow/ui.md) — `thread.metadata.allowedTools.includes(toolId)` check with the full namespaced id as key | [Architecture §6 State Ownership](../../../../architecture/architecture.md#6-state-ownership) |
| Allow-for-thread persistence | **Reused** from [F17](../tool-confirmation-flow/ui.md) + [F14](../conversation-persistence-v1/feature.md) — `ConversationStore.mutate(threadId, draft => draft.metadata.allowedTools.push(toolId))` with dedupe; the full namespaced id is the key, no schema change | [Architecture §6 State Ownership](../../../../architecture/architecture.md#6-state-ownership); [Conversation Persistence](../../../../standards/tech-stack.md#agent--tool--skill--mcp-wiring) |
| Deny → tool-error | **Reused** from [F17](../tool-confirmation-flow/ui.md) — `ToolResult{ok:false, error:"user denied mcp.<serverId>.<toolName>"}` fed back into the LangGraph turn loop | [Architecture §7 Error Handling Strategy](../../../../architecture/architecture.md#7-error-handling-strategy); [Code style → LangGraph / Agent Layer](../../../../standards/code-style.md#langgraph--agent-layer) |
| `interrupt()` wiring | **Reused** from [F17](../tool-confirmation-flow/ui.md) — LangGraph [`interrupt()`](../../../../standards/tech-stack.md#agent--tool--skill--mcp-wiring) pauses the graph; resumes on `resolve({decision})`; no ad-hoc event bus | [Architecture §1](../../../../architecture/architecture.md#1-architectural-principles); [Architecture §5.5 MCP Tool Call](../../../../architecture/architecture.md#55-mcp-tool-call) |
| Structured logging (new) | `mcp.tool.confirmation.default { toolId, serverId }` at `debug` via [F01 Logger](../plugin-bootstrap-logging/feature.md) — fired once per MCP tool registration; never carries args / env / headers per [Code style → Logging](../../../../standards/code-style.md#logging) | [Logging](../../../../standards/code-style.md#logging) |
| Structured logging (reused) | `tool.confirmation.request / allow-once / allow-thread / deny` from [F17](../tool-confirmation-flow/ui.md) — emitted with `{toolId: "mcp.<serverId>.<toolName>", thread, decision}`; no new runtime event types added | [Logging](../../../../standards/code-style.md#logging) |
| SR phrasing | `aria-live="assertive"` one-shot on mount: `"Leo requests permission to use <serverName>: <toolName>. External MCP tool — first call in this thread."` — read via the friendly title, never the raw namespaced id, for WCAG parity with the visual label | [UI Layer](../../../../standards/tech-stack.md#ui-layer); [Architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) |
| Reduced-motion handling | **Reused** from [F17](../tool-confirmation-flow/ui.md) — `@media (prefers-reduced-motion: reduce)` drops mount fade; state machines unchanged | [Code style → Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) |
| Unit tests | Vitest + jsdom per [NFR-TEST-01](../../context.md#nfr-test-01) and [NFR-TEST-05](../../context.md#nfr-test-05): every `mcp.*` spec has `requiresConfirmation === true` at registration (AC1); first MCP call mounts F17 dialog with generic MCP icon + friendly title + namespaced-id header (AC2, AC7); Allow-for-thread persists full namespaced id into `thread.metadata.allowedTools` and bypasses on next call (AC3); Allow-once does not persist + re-prompts (AC4); Deny synthesises `ToolResult{ok:false, error:"user denied <toolId>"}` (AC5); fresh thread + cross-`serverId` re-prompt (AC6); data-visual-state = "awaiting-confirmation" + data-tool-source = "mcp" snapshot (AC7); `mcp.tool.confirmation.default` debug log with `{toolId, serverId}` at registration (AC8); native `Modal` constructor never invoked for MCP path (AC7); integration fixture reuses F51's stdio MCP fixture server | [Testing](../../../../standards/tech-stack.md#testing); [Code style → Testing (Vitest + msw)](../../../../standards/code-style.md#testing-vitest--msw) |

Accessibility invariants ([Architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views)):

- All F17 a11y invariants apply unchanged — `role="dialog"` + `aria-modal="true"` + focus trap on three buttons + Esc = Deny + focus-return on resolve + keyboard-only operability per [NFR-USE-06](../../context.md#nfr-use-06) and [NFR-USE-08](../../context.md#nfr-use-08).
- SR phrasing uses the friendly `<serverName>: <toolName>` title rather than the raw namespaced id, matching the visual label for WCAG 1.3.1.
- MCP-ness is surfaced redundantly (not colour-only): via the subtitle copy "External MCP tool — first call in this thread.", via the `plug` icon, via the mono namespaced-id header, AND via the `data-tool-source="mcp"` attribute — status never carried by colour alone per [NFR-USE-04](../../context.md#nfr-use-04).
- Zero colour literals — reuses F17's Obsidian CSS variable styling verbatim per [Code style → Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian).
- Native Obsidian `Modal` never used on the MCP path — Vitest spy asserts `Modal` constructor is not invoked when an `mcp.*` tool reaches the confirmation flow per [FR-UI-08](../../context.md#fr-ui-08) (AC7 of [feature.md](./feature.md)).

See also: [tech-stack.md → Agent / Tool / Skill / MCP Wiring](../../../../standards/tech-stack.md#agent--tool--skill--mcp-wiring), [tech-stack.md → UI Layer](../../../../standards/tech-stack.md#ui-layer), [tech-stack.md → Platform APIs](../../../../standards/tech-stack.md#platform-apis), [tech-stack.md → Testing](../../../../standards/tech-stack.md#testing).

## Back-link

[← feature.md](./feature.md)
