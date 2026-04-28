# F24 — Plan mode controller & permission gate · UI

Back-link: [feature.md](./feature.md).

UI surface, Obsidian platform-API wiring, and agent-layer seams come from [tech-stack — UI Layer](../../../../standards/tech-stack.md#ui-layer), [tech-stack — Platform APIs](../../../../standards/tech-stack.md#platform-apis), [tech-stack — Agent / Tool / Skill / MCP Wiring](../../../../standards/tech-stack.md#agent--tool--skill--mcp-wiring), [architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views), [architecture §3.2](../../../../architecture/architecture.md#32-agent-layer), [architecture §4](../../../../architecture/architecture.md#4-key-contracts), [architecture §5.3](../../../../architecture/architecture.md#53-chat-turn-with-tool-call--confirmation), [architecture §6](../../../../architecture/architecture.md#6-state-ownership), [architecture §7](../../../../architecture/architecture.md#7-error-handling-strategy), [architecture §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules).

Plan-mode is a **permission-system** enforcement boundary — never a prompt-only hint — per [FR-PLAN-05](../../context.md#fr-plan-05) and [NFR-REL-07](../../context.md#nfr-rel-07). The UI surfaces this in three visible ways: a persistent HeaderBar badge while the flag is on, an inline **tool-error** `PlanModeBlocked` banner when the agent attempts a non-allowlisted tool, and a command-palette entry that flips the flag. Mode-transition and stale-todo reminders are rendered **muted** because they are routed at the model message-stream (never the user transcript) per [FR-PLAN-03](../../context.md#fr-plan-03) / [FR-PLAN-08](../../context.md#fr-plan-08); where shown here, they appear only because we are illustrating the model-facing attachment payload for the reader's benefit.

## Layout

### 1. [F04](../chat-sidebar-view/feature.md) HeaderBar — plan-mode badge ACTIVE (width ≥ 280px)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Leo  ·  thread-2026-04-20  ·  [⚙ General ▾]  [◐ Plan mode]   [⋯][✕] │
└──────────────────────────────────────────────────────────────────────┘
                                                 ▲
                                    HeaderBar plan-mode badge
                              role="status" aria-live="polite"
                              aria-label="Plan mode active — write tools blocked"
                              data-visual-state="plan-mode"
                              focus-ring = var(--interactive-accent)
                              icon       = setIcon("circle-half")
                              tint       = var(--color-blue) border + var(--background-secondary) fill
```

Badge = `setIcon("circle-half")` + label `"Plan mode"`; only mounted while `PlanModeController.modeOf(thread) === "plan"` per AC-1 on [feature.md](./feature.md). Rendered inside the HeaderBar region scaffolded by [F04 chat-sidebar-view](../chat-sidebar-view/feature.md) beside the skill picker from [F22](../skills-picker-active-skill/feature.md). Badge is **non-interactive** (status region, not a button) — toggling happens via the command palette (Wireframe 4) or the agent's `EnterPlanMode` / `ExitPlanMode` tools; the badge exists so the user always knows the permission flag is on per [NFR-REL-07](../../context.md#nfr-rel-07) ("visible enforcement, not prompt-only").

### 2. HeaderBar — plan-mode OFF (badge absent; default)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Leo  ·  thread-2026-04-20  ·  [⚙ General ▾]               [⋯]  [✕]  │
└──────────────────────────────────────────────────────────────────────┘
                                           (badge unmounted — DOM subtree
                                            returns null when mode==="normal")
```

When `mode === "normal"` (the default per AC-1), the badge component returns `null`: no empty slot, no `display:none` placeholder — the DOM subtree is fully unmounted so screen readers never see a stale label, matching the hidden/empty-state discipline of [F09 chat-context-indicator UI](../chat-context-indicator/ui.md).

### 3. Tool attempt blocked — inline `PlanModeBlocked` tool-error banner in transcript

```
 0        10        20        30        40        50
 |---------|---------|---------|---------|---------|   min-width marker: 280 px
+--------------------------------------------------+
| ...transcript bubbles above (from F05)...        |
+--------------------------------------------------+
| ┌══════════════════════════════════════════════┐ |   <- amber-on-danger banner
| │ [⚠] Plan mode — write tool blocked           │ |      role="alert"
| │                                              │ |      aria-live="assertive"
| │  write tool blocked in plan mode:            │ |      data-visual-state="error"
| │  create_note                                 │ |      data-error-kind="PlanModeBlocked"
| │                                              │ |
| │  Allowed tools while plan mode is on:        │ |
| │  Read · Grep · Glob · WebFetch ·             │ |
| │  EnterPlanMode · ExitPlanMode · plan-file-   │ |
| │  write                                       │ |
| │                                              │ |
| │  [Exit plan mode to continue]                │ |   <- secondary affordance
| └══════════════════════════════════════════════┘ |      (opens command-palette
+--------------------------------------------------+       entry "Leo: Toggle plan mode")
| ...composer below (from F06)...                  |
+--------------------------------------------------+

rendered by    : [F13 ui-visual-states-notifications](../ui-visual-states-notifications/feature.md)
                  as an `error` / inline tool-error bubble — same channel as
                  any other typed tool-error per [architecture §7](../../../../architecture/architecture.md#7-error-handling-strategy)
source event   : ToolResult{ok: false, error: "blocked by plan mode: create_note"}
                  fed back into the LangGraph turn loop by the permission gate
                  (NOT the [F17 ConfirmationController](../tool-confirmation-flow/feature.md) — dialog NEVER fires on this path; see AC-2)
header tint    : var(--color-orange) border + var(--background-modifier-error) fill
                  (write-family danger, inherited from F13 palette)
icon           : setIcon("alert-triangle") via F13 iconFor("error")
copy           : "write tool blocked in plan mode: <toolId>"   (verbatim ACs)
button         : "[Exit plan mode to continue]" dispatches
                  Plugin.addCommand callback id="leo-toggle-plan-mode"
                  (same entry point as Wireframe 4; keyboard reachable Tab stop)
```

Crucially, this banner is **not** a [F17 confirmation dialog](../tool-confirmation-flow/feature.md) — no `[Allow once][Allow for thread][Deny]` actions, because the tool never reached invoke. The permission gate in [F10 AgentRunner](../agent-controller-core/feature.md)'s turn loop short-circuited to a typed `PlanModeBlocked` tool-error **before** [F17 ConfirmationController](../tool-confirmation-flow/feature.md) was consulted, per AC-2 and [architecture §5.3](../../../../architecture/architecture.md#53-chat-turn-with-tool-call--confirmation). A Vitest assertion confirms zero F17 dialog invocations along this path, and the distinct `data-error-kind="PlanModeBlocked"` attribute lets the banner style differently from a generic tool-error while reusing the F13 error channel.

### 4. Command palette entry — `Leo: Toggle plan mode` (`Plugin.addCommand`)

```
┌─ Cmd/Ctrl+P ─ Command palette ──────────────────────────────────────┐
│ > plan mode                                                          │
│ ─────────────────────────────────────────────────────────────────── │
│   Leo: Toggle plan mode                                              │
│   Leo: Select skill…                                                 │
│   Leo: New thread                                                    │
└──────────────────────────────────────────────────────────────────────┘
            │
            ▼ callback → PlanModeController.toggle(activeThread)
                          - flips mode flag
                          - queues PendingReminder (plan-enter or plan-exit)
                          - emits plan.mode.enter / plan.mode.exit log event
                          - if ExitPlanMode-equivalent path: calls
                            PlanStore.writePlan(planDraft)  (F23)

registration   : Plugin.addCommand({
                   id: "leo-toggle-plan-mode",
                   name: "Leo: Toggle plan mode",
                   callback: togglePlanMode
                 })
disposition    : auto-disposed on Plugin.onunload per [architecture §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules)
keyboard       : globally reachable via Cmd/Ctrl+P (no custom hotkey claimed)
```

Manual toggling fulfils the "Plan mode" glossary entry in [context.md](../../context.md#glossary) and mirrors the toggle source enumerated in the state machine below (`manual toggle` reason). One handler backs both the command-palette entry and the `[Exit plan mode to continue]` banner button in Wireframe 3, matching the "single handler" discipline established by [F22 SkillPicker](../skills-picker-active-skill/ui.md).

### 5. Stale-todo reminder attachment — muted `<system-reminder>` payload (model-only)

```
   NOT RENDERED IN THE USER-VISIBLE TRANSCRIPT
   (routed onto the outgoing message stream to the model only
   per [FR-PLAN-03](../../context.md#fr-plan-03) / plan.md §3.8)

   Illustration of the attachment payload for reviewer context only:

   ┌─ next AgentRunner.send() outgoing stream ──────────────────┐
   │                                                            │
   │   <system-reminder>                                        │
   │     Your todo list is stale. You have N open todos and     │
   │     have done work without calling TodoWrite. Call         │
   │     TodoWrite to update them.                              │
   │   </system-reminder>                                       │
   │                                                            │
   │   [user message content here]                              │
   │                                                            │
   └────────────────────────────────────────────────────────────┘

   If any agent tool ever echoed this into the transcript,
   it would be styled muted (reviewer-only aid):
     color          = var(--text-muted)
     background     = var(--background-secondary)
     font-style     = italic
     data-system-reminder = "true"
     role           = "note"
     aria-label     = "System reminder (model-only)"
```

Per AC-6 and [FR-PLAN-03](../../context.md#fr-plan-03), the reminder is injected into the outgoing message stream at turn boundaries **only when**: (a) `TodoStore.get(thread.agentId ?? thread.id)` is non-empty, (b) messages-since-last-reminder ≥ `settings.staleTodoReminderThreshold` (default 10), (c) the most recent assistant turn produced ≥ 1 `tool_call` event without a `TodoWrite` invocation. It is **never** rendered as a user-facing bubble. The muted styling shown above is the reviewer aid we use in docs and in dev-mode transcript dumps only (behind a debug flag per [code-style — Logging](../../../../standards/code-style.md#logging) — reminder body never logged above `debug`).

### 6. Mode-transition reminder attachment — muted `<system-reminder>` (model-only)

```
   Same model-only channel as Wireframe 5 — never in user transcript.

   On EnterPlanMode the queued PendingReminder.kind="plan-enter":

   ┌─ next AgentRunner.send() outgoing stream ──────────────────┐
   │   <system-reminder>                                        │
   │     You are now in plan mode. Write tools are blocked.     │
   │     Only Read, Grep, Glob, WebFetch, EnterPlanMode,        │
   │     ExitPlanMode, and the plan-file-write path are         │
   │     permitted. Call ExitPlanMode({plan}) to commit.        │
   │   </system-reminder>                                       │
   └────────────────────────────────────────────────────────────┘

   On ExitPlanMode the queued PendingReminder.kind="plan-exit":

   ┌─ next AgentRunner.send() outgoing stream ──────────────────┐
   │   <system-reminder>                                        │
   │     Plan mode has exited. All tools are available again.   │
   │     The plan has been written to <PlanStore path>.         │
   │   </system-reminder>                                       │
   └────────────────────────────────────────────────────────────┘

   Rapid toggle enter→exit (or exit→enter): queue tail is the opposite
   of the newly-queued reminder → BOTH are dropped. Net zero reminders
   ship on the next turn per AC-5 / [FR-PLAN-08](../../context.md#fr-plan-08).
```

Per AC-4 and [FR-PLAN-08](../../context.md#fr-plan-08), each `EnterPlanMode` / `ExitPlanMode` transition enqueues a `PendingReminder` of kind `plan-enter` or `plan-exit` (body wrapped byte-for-byte in `<system-reminder>…</system-reminder>` tags from plan.md §6) into a per-thread FIFO. The head is prepended to the next outgoing message stream and the queue drained; the opposing-flag clearing rule cancels both entries on rapid toggle so a round-trip ships zero reminders.

## State machine

### Per-thread `mode` flag (controller-owned)

```
               manual toggle             manual toggle
               (Plugin.addCommand)       (Plugin.addCommand)
               or EnterPlanMode tool     or ExitPlanMode tool
               ┌─────────────────────┐   ┌─────────────────────┐
               ▼                     │   ▼                     │
         ┌──────────┐         ┌──────┴──┐         ┌──────────┐
         │          │  enter  │         │  exit   │          │
         │  normal  │────────►│  plan   │────────►│  normal  │
         │          │         │         │         │          │
         └──────────┘         └─────────┘         └──────────┘
               ▲                  │                    ▲
               │                  │ subagent invoke    │
               │                  │ (ctx.thread.agentId
               │                  │  != null)          │
               │                  ▼                    │
               │           ┌────────────────┐          │
               └───────────│ REJECT:        │──────────┘
                  no-op    │ typed error    │  no-op
                  (state   │ PlanModeForbid │  (state
                  unchanged)│ denInSubagent │  unchanged)
                           └────────────────┘
                             logs plan.mode.subagent-reject
```

Initial state: `normal` on every plugin load (flag NOT persisted — resume is [F26](../../features-index.md)'s job) per AC-1.

**Transition reasons (the "why" behind each edge):**

- `normal → plan` via **manual toggle** (user invokes `"Leo: Toggle plan mode"` from the command palette) OR **agent tool-call** (`EnterPlanMode` via [F16 ToolRegistry](../tool-registry-builtin-read/feature.md)); both paths flip the flag, enqueue `plan-enter` `PendingReminder`, emit `plan.mode.enter` log ([NFR-LOG-04](../../context.md#nfr-log-04)).
- `plan → normal` via **manual toggle** OR **agent tool-call** (`ExitPlanMode({plan})` via [F16 ToolRegistry](../tool-registry-builtin-read/feature.md)); the tool path additionally writes `plan` through [`PlanStore.writePlan`](../plan-files-todos-store/feature.md) **before** flipping the flag, then enqueues `plan-exit` `PendingReminder`, emits `plan.mode.exit` log.
- `plan/normal → (unchanged)` via **subagent reject**: when `EnterPlanMode` or `ExitPlanMode` is invoked with `ctx.thread.agentId != null`, the tool fails with typed `PlanModeForbiddenInSubagent` ([FR-PLAN-04](../../context.md#fr-plan-04)); no state transition, no attachment queued, no `PlanStore.writePlan` write, log `plan.mode.subagent-reject` per AC-3.

### Attachment queue (per-thread FIFO)

```
    enqueue(plan-enter)      enqueue(plan-exit)
    (opposite NOT tail)      (opposite NOT tail)
    ┌──────────────────┐     ┌──────────────────┐
    ▼                  │     ▼                  │
┌───────┐       ┌────────────────┐        ┌──────────────────┐
│       │ enqueue│                │enqueue │                  │
│ empty │──────►│ queued(enter)  │───────►│ queued(enter,    │
│       │       │                │        │  exit) (size=2)  │ ── rapid-toggle
└───────┘       └────────────────┘        │  * impossible *  │    clearing prevents
    ▲                  │                  └──────────────────┘    size>1 with opposites
    │                  │
    │                  │ AgentRunner.send
    │                  │ (next turn)
    │                  ▼
    │          ┌────────────────┐
    │          │   flushed      │
    └──────────│ (head prepended│
     drained   │  to outgoing   │
               │  stream;       │
               │  queue.shift())│
               └────────────────┘

    opposing-flag clearing (fast path):
    ┌────────────────────┐                  ┌──────────┐
    │ queued(enter)      │── enqueue(exit)  │          │
    │  tail=plan-enter   │──────────────────│  empty   │
    └────────────────────┘     both dropped └──────────┘
                              log plan.attachment.cleared-opposing
                              {droppedKinds: ["plan-enter","plan-exit"]}
    ┌────────────────────┐                  ┌──────────┐
    │ queued(exit)       │── enqueue(enter) │          │
    │  tail=plan-exit    │──────────────────│  empty   │
    └────────────────────┘     both dropped └──────────┘
```

Lifecycle: `empty → queued(plan-enter | plan-exit) → flushed → empty`. The opposing-flag clearing rule collapses a rapid enter→exit (or exit→enter) round-trip so **net zero reminders** ship on the next turn per AC-5. Queue is cleared on `Plugin.onunload` per [architecture §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules).

### Stale-todo rate-limiter (per-thread counters)

```
    ┌─────────────────────────┐
    │ messagesSinceLastReminder│  incremented on every assistant turn boundary
    │  : number  (init 0)      │  reset to 0 on each reminder injection
    └─────────────────────────┘
               │
               │ turn-boundary hook in F10 AgentRunner
               ▼
    ┌─────────────────────────────────────────────────────────────┐
    │ maybeInjectStaleTodoReminder(thread, lastAction):            │
    │                                                              │
    │   (a) TodoStore.get(thread.agentId ?? thread.id).length > 0  │
    │ ∧ (b) messagesSinceLastReminder ≥ N   (N=10 default)         │
    │ ∧ (c) lastAction.hasToolCall && !lastAction.hasTodoWrite     │
    │                                                              │
    │   ──► yes: inject <system-reminder>... into next outgoing    │
    │          stream; log plan.stale-todo.reminder; reset counter │
    │                                                              │
    │   ──► no:  log plan.stale-todo.suppressed                    │
    │          {reason: "empty"|"rate-limit"|"todowrite-called"}   │
    └─────────────────────────────────────────────────────────────┘
```

N is sourced from `settings.staleTodoReminderThreshold` (default 10; surfaced in [F03 settings-tab-scaffold](../settings-tab-scaffold/feature.md)'s Plan/Todos section per [feature.md](./feature.md) open questions). Counter and last-reminder anchor live in-memory on `PlanModeController`, keyed by `thread.id`, and are cleared on `Plugin.onunload` per AC-6 / [architecture §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules).

## Event flow

### A. Enter plan mode — user or agent path

```
[User: Cmd/Ctrl+P → "Leo: Toggle plan mode"]
          OR
[Agent tool_call: EnterPlanMode({})]
          │
          ▼
  PlanModeController.enter(thread)
          │
          ├── if ctx.thread.agentId != null   →  throw PlanModeForbiddenInSubagent
          │                                      logger.log("plan.mode.subagent-reject", {threadId})
          │                                      (no state change; see Event flow D)
          │
          ▼
  controller.mode = "plan"   (permission flag flipped; per-thread)
          │
          ├─► logger.log("plan.mode.enter", {threadId})   (F01 Logger per NFR-LOG-04)
          │
          ├─► HeaderBar badge mounts (Wireframe 1)
          │     React re-render triggered by controller.onModeChange
          │     data-visual-state="plan-mode" set; aria-live="polite" announce
          │
          ├─► attachment queue: enqueue PendingReminder{kind:"plan-enter"}
          │     if queue.tail === {kind:"plan-exit"}:
          │       drop both ends  → logger.log("plan.attachment.cleared-opposing",
          │                            {threadId, droppedKinds:["plan-exit","plan-enter"]})
          │     else:
          │       queue.push(reminder)
          │       logger.log("plan.attachment.queued", {threadId, kind:"plan-enter"})
          │
          ▼
  (next AgentRunner.send injects the head of the queue; see Event flow C)
```

### B. Write-tool attempt while plan mode is on — permission gate BLOCKS

```
[Agent tool_call: create_note({path:"...", content:"..."})]
          │
          ▼
  AgentRunner turn loop → permission gate (BEFORE F17 ConfirmationController)
          │
          │   // pre-invoke check, per [architecture §5.3](../../../../architecture/architecture.md#53-chat-turn-with-tool-call--confirmation)
          │   if PlanModeController.modeOf(thread) === "plan":
          │     allowlist = {Read, Grep, Glob, WebFetch,
          │                  EnterPlanMode, ExitPlanMode, plan-file-write}
          │     if toolId ∉ allowlist:
          │       return ToolResult{ok:false, error:"blocked by plan mode: create_note"}
          │
          ▼
  typed PlanModeBlocked tool-error flows BACK INTO THE GRAPH per
  [architecture §7](../../../../architecture/architecture.md#7-error-handling-strategy)
          │
          ├─► logger.log("plan.mode.tool-blocked", {toolId:"create_note", thread})
          │     (no args payload logged — plan content and tool args stay < debug)
          │
          ├─► F17 ConfirmationController dialog is NEVER invoked on this path
          │     (Vitest asserts zero dialog mounts per AC-2 / NFR-REL-07)
          │
          ▼
  F13 renders inline tool-error banner in transcript (Wireframe 3)
          │
          │   role="alert"  aria-live="assertive"
          │   data-error-kind="PlanModeBlocked"
          │   copy: "write tool blocked in plan mode: create_note"
          │   [Exit plan mode to continue] button  →  Plugin.addCommand callback
          ▼
  [User sees banner]  (NOT a prompt plea — visible permission enforcement)
```

This path is the load-bearing invariant for [NFR-REL-07](../../context.md#nfr-rel-07): enforcement is the permission system (not the prompt), and the user sees it happen visibly. The gate-before-confirmation ordering is the contract the gate is registered against in [F10 AgentRunner](../agent-controller-core/feature.md)'s turn loop per [architecture §5.3](../../../../architecture/architecture.md#53-chat-turn-with-tool-call--confirmation).

### C. Exit plan mode — writes plan file via F23 PlanStore, clears badge

```
[Agent tool_call: ExitPlanMode({plan: "1. ...\n2. ..."})]
          OR
[User: Cmd/Ctrl+P → "Leo: Toggle plan mode"]  (no plan payload — manual exit)
          │
          ▼
  PlanModeController.exit(thread, {plan?})
          │
          ├── if ctx.thread.agentId != null   →  throw PlanModeForbiddenInSubagent
          │                                      (symmetric with Event flow A)
          │
          ├── if plan provided (tool path):
          │     PlanStore.writePlan(plan)        (F23 — AC-1 ordering: write BEFORE flip)
          │                                        [PlanStore contract](../plan-files-todos-store/feature.md)
          │
          ▼
  controller.mode = "normal"   (permission flag flipped back)
          │
          ├─► logger.log("plan.mode.exit", {threadId, slug: PlanStore.currentSlug()})
          │     (slug from F23 PlanStore; plan content itself NEVER logged above debug)
          │
          ├─► HeaderBar badge UNMOUNTS (Wireframe 2)
          │     React subtree returns null; data-visual-state attr cleared
          │
          ├─► attachment queue: enqueue PendingReminder{kind:"plan-exit"}
          │     opposing-flag clearing: if queue.tail === {kind:"plan-enter"} → drop both
          │     else: queue.push(reminder) + log plan.attachment.queued
          │
          ▼
  next AgentRunner.send(thread):
          │
          ├─► pendingReminders = queue.drain()
          │     queue.shift() → head = PendingReminder{kind:"plan-exit"}
          │     outgoing = [head.body as <system-reminder>...</system-reminder>, ...userMsgs]
          │     logger.log("plan.attachment.flushed", {threadId, kind:"plan-exit"})
          │
          ▼
  ProviderManager.stream(outgoing, {signal, tools, model})
  (tools set is now the FULL registry again because mode === "normal")
```

### D. Subagent reject path — no state change, no writes, typed error + log

```
[Subagent tool_call: EnterPlanMode({})  OR  ExitPlanMode({plan})]
    (ctx.thread.agentId != null — subagent-flagged context)
          │
          ▼
  Tool adapter guard: ctx.thread.agentId == null ?
          │
          └── NO  →  throw PlanModeForbiddenInSubagent
                    logger.log("plan.mode.subagent-reject", {threadId, agentId, toolId})
                    ToolResult{ok:false, error:"PlanModeForbiddenInSubagent"}
                    │
                    │  // NO state transition — controller.mode unchanged
                    │  // NO attachment queued
                    │  // NO PlanStore.writePlan write
                    ▼
                    typed tool-error surfaces in transcript via F13 error banner
                    (same channel as Wireframe 3 but with data-error-kind=
                    "PlanModeForbiddenInSubagent")
```

Flagged vacuous in Phase 2 (Leo has no subagent runtime yet) but wired anyway so the guard is in place when [context.md open questions](../../context.md#open-questions) "Plan mode in subagent contexts" is resolved per AC-3 / [FR-PLAN-04](../../context.md#fr-plan-04).

### E. Rapid toggle — enter → exit within a single user idle, net zero reminders

```
t0: EnterPlanMode(thread) called
      │
      ├─► controller.mode = "plan"
      ├─► queue = [PendingReminder{kind:"plan-enter"}]
      ├─► HeaderBar badge mounts
      └─► log plan.attachment.queued {kind:"plan-enter"}

t1 (before next AgentRunner.send): ExitPlanMode(thread, {plan:"..."}) called
      │
      ├─► PlanStore.writePlan("...")   (still runs — the plan file is persisted)
      ├─► controller.mode = "normal"
      ├─► HeaderBar badge unmounts
      │
      │  queue.tail === {kind:"plan-enter"}  ──► opposing match!
      │
      ├─► queue = []   (both entries dropped)
      └─► log plan.attachment.cleared-opposing {droppedKinds:["plan-enter","plan-exit"]}

t2: AgentRunner.send(thread)
      │
      ├─► pendingReminders = queue.drain()   →  []
      ├─► outgoing = [...userMsgs]           (no <system-reminder> prefix)
      └─► ProviderManager.stream(outgoing, ...)
```

Per AC-5 and [FR-PLAN-08](../../context.md#fr-plan-08)'s "opposing-flag rule", a quick enter→exit (or exit→enter) round-trip ships zero reminders on the next turn. The `plan.attachment.cleared-opposing` log event is the single source of truth for this rule in the Vitest suite.

### F. Stale-todo reminder fires (or is suppressed) at turn boundary

```
AgentRunner turn boundary (after each assistant turn resolves)
      │
      ▼
PlanModeController.maybeInjectStaleTodoReminder(thread, lastAction)
      │
      ├── (a) todos = TodoStore.get(thread.agentId ?? thread.id)   (F23)
      │       todos.length === 0 ?
      │         └── yes → log plan.stale-todo.suppressed {reason:"empty"}
      │                   return
      │
      ├── (b) messagesSinceLastReminder < settings.staleTodoReminderThreshold ?
      │         └── yes → log plan.stale-todo.suppressed {reason:"rate-limit"}
      │                   return
      │
      ├── (c) lastAction.hasTodoWrite ?
      │         └── yes → log plan.stale-todo.suppressed {reason:"todowrite-called"}
      │                   return
      │
      ▼
  all three conditions pass — inject <system-reminder> into next outgoing stream
      │
      ├─► outgoing.prepend(<system-reminder>...</system-reminder>)  (model-only)
      ├─► messagesSinceLastReminder = 0
      └─► logger.log("plan.stale-todo.reminder", {threadId, todoCount: todos.length})
```

Per AC-6 and [FR-PLAN-03](../../context.md#fr-plan-03) / plan.md §3.8. The reminder is **never** routed to the user-visible transcript channel ([F05 chat-message-list-markdown](../chat-message-list-markdown/feature.md)) — a Vitest assertion confirms it only appears in the model message-stream.

### G. Teardown

```
Plugin.onunload()
      │
      ▼
PlanModeController.dispose()
      │
      ├─► per-thread mode flags cleared
      ├─► attachment queue drained without flushing (process is exiting)
      ├─► stale-todo counters cleared
      ├─► Plugin.addCommand("leo-toggle-plan-mode") auto-disposed by Obsidian
      ├─► HeaderBar badge React subtree unmounts via ChatView.onClose
      └─► registered via useEffect cleanup + Plugin.registerDomEvent
            (per [code-style — Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns))
```

Matches [architecture §10 Concurrency & Lifecycle Rules](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) — no timers held open, no persisted state to drain.

## Component mapping

| UI element | Implementation | Contract link |
|---|---|---|
| HeaderBar plan-mode badge | React `<span role="status" aria-live="polite" data-visual-state="plan-mode">` with `setIcon("circle-half")` + label `"Plan mode"`; only mounted while `mode === "plan"` | [tech-stack — UI Layer](../../../../standards/tech-stack.md#ui-layer), [tech-stack — Platform APIs](../../../../standards/tech-stack.md#platform-apis), [architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views) |
| Badge icon | Lucide `circle-half` via `setIcon("circle-half")` (or equivalent from Obsidian icon set) | [tech-stack — Platform APIs](../../../../standards/tech-stack.md#platform-apis) |
| Badge tint | `var(--color-blue)` border + `var(--background-secondary)` fill — zero colour literals; Obsidian semantic tokens only | [tech-stack — UI Layer](../../../../standards/tech-stack.md#ui-layer), [code-style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) |
| Badge mount/unmount | React subtree returns `null` when `mode === "normal"`; subscribes to `PlanModeController.onModeChange(threadId)` via `useEffect` | [architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views), [code-style — React 18](../../../../standards/code-style.md#react-18) |
| Collapsed HeaderBar at <280px | `data-collapsed="true"` attribute inherited from [F04](../chat-sidebar-view/feature.md) `ResizeObserver`; badge keeps the icon + `aria-label`, drops the `"Plan mode"` text and shows native `title="Plan mode active — write tools blocked"` | [architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views), [NFR-USE-09](../../context.md#nfr-use-09) |
| `PlanModeBlocked` banner | Inline transcript bubble via [F13 ui-visual-states-notifications](../ui-visual-states-notifications/feature.md) `error` channel — `role="alert"` `aria-live="assertive"` `data-visual-state="error"` `data-error-kind="PlanModeBlocked"` | [tech-stack — UI Layer](../../../../standards/tech-stack.md#ui-layer), [architecture §7](../../../../architecture/architecture.md#7-error-handling-strategy) |
| Banner icon | `setIcon("alert-triangle")` via [F13 iconFor](../ui-visual-states-notifications/feature.md) error family | [tech-stack — Platform APIs](../../../../standards/tech-stack.md#platform-apis) |
| Banner tint | `var(--color-orange)` border + `var(--background-modifier-error)` fill (write-family danger from F13 palette) | [tech-stack — UI Layer](../../../../standards/tech-stack.md#ui-layer), [code-style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) |
| Banner copy | `"write tool blocked in plan mode: <toolId>"` — verbatim from AC-2 | (AC-2 on [feature.md](./feature.md)) |
| `[Exit plan mode to continue]` button | Native `<button>` dispatching the `leo-toggle-plan-mode` command via `(app as any).commands.executeCommandById("leo:leo-toggle-plan-mode")` — keyboard reachable Tab stop | [tech-stack — Platform APIs](../../../../standards/tech-stack.md#platform-apis), [NFR-USE-05](../../context.md#nfr-use-05) |
| Permission gate ordering | Gate runs **before** [F17 ConfirmationController](../tool-confirmation-flow/feature.md) in [F10 AgentRunner](../agent-controller-core/feature.md)'s turn loop; Vitest asserts zero F17 dialog invocations on the blocked path | [architecture §5.3](../../../../architecture/architecture.md#53-chat-turn-with-tool-call--confirmation), [NFR-REL-07](../../context.md#nfr-rel-07) |
| `EnterPlanMode` / `ExitPlanMode` tools | `ToolSpec` registered with [F16 ToolRegistry](../tool-registry-builtin-read/feature.md) via `@langchain/core/tools` `tool()` + Zod schema (Zod `z.object({plan: z.string().describe(...)})` on `ExitPlanMode` per [code-style — Zod & Tool Schemas](../../../../standards/code-style.md#zod--tool-schemas)) | [tech-stack — Agent / Tool / Skill / MCP Wiring](../../../../standards/tech-stack.md#agent--tool--skill--mcp-wiring), [architecture §4](../../../../architecture/architecture.md#4-key-contracts) |
| Subagent guard | Both tools check `ctx.thread.agentId == null`; fail fast with typed `PlanModeForbiddenInSubagent` per [code-style — Error Handling](../../../../standards/code-style.md#error-handling) | [architecture §7](../../../../architecture/architecture.md#7-error-handling-strategy), [FR-PLAN-04](../../context.md#fr-plan-04) |
| Command palette entry | `Plugin.addCommand({id:"leo-toggle-plan-mode", name:"Leo: Toggle plan mode", callback:togglePlanMode})` registered on `Plugin.onload`, auto-disposed on `onunload` | [tech-stack — Platform APIs](../../../../standards/tech-stack.md#platform-apis), [architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views), [architecture §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) |
| Toggle `Notice` hints | Optional one-shot `Notice` on manual toggle (`new Notice("Plan mode on")` / `new Notice("Plan mode off — plan saved")`) — never for the tool-path transitions (the transcript bubbles cover that) | [tech-stack — Platform APIs](../../../../standards/tech-stack.md#platform-apis) (`Notice` API) |
| `PlanStore.writePlan` | Called by `ExitPlanMode` on the tool path **before** flipping the flag; read-only access from this feature otherwise | [F23 plan-files-todos-store](../plan-files-todos-store/feature.md), [architecture §3.2](../../../../architecture/architecture.md#32-agent-layer) |
| `TodoStore` read | `TodoStore.get(thread.agentId ?? thread.id)` consumed by `maybeInjectStaleTodoReminder` rate-limiter only; never mutated here | [F23 plan-files-todos-store](../plan-files-todos-store/feature.md), [architecture §6](../../../../architecture/architecture.md#6-state-ownership) |
| `PlanModeController` location | `src/agent/PlanModeController.ts` alongside [F10 AgentRunner](../agent-controller-core/feature.md) and [F16 ToolRegistry](../tool-registry-builtin-read/feature.md) per [architecture §9](../../../../architecture/architecture.md#9-project-file-layout-proposed) | [architecture §3.2](../../../../architecture/architecture.md#32-agent-layer), [architecture §6](../../../../architecture/architecture.md#6-state-ownership) |
| Attachment queue data structure | Per-thread FIFO `Array<PendingReminder>` held in-memory on `PlanModeController`; `<system-reminder>` body byte-identical to plan.md §6; cleared on `Plugin.onunload` | [architecture §6](../../../../architecture/architecture.md#6-state-ownership), [architecture §10](../../../../architecture/architecture.md#10-concurrency--lifecycle-rules) |
| Muted `<system-reminder>` styling (debug view only) | `color: var(--text-muted); background: var(--background-secondary); font-style: italic; data-system-reminder="true"; role="note"; aria-label="System reminder (model-only)"` — never rendered in production user transcript; shown only in dev-mode transcript dumps behind a debug flag | [tech-stack — UI Layer](../../../../standards/tech-stack.md#ui-layer), [code-style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) |
| Keyboard reachability | Badge is a status region (not a Tab stop, intentional — status-only); command palette (`Cmd/Ctrl+P`) + banner button are the two keyboard-reachable entry points; Esc does NOT toggle plan mode (to avoid collision with [F06](../chat-composer-input/ui.md) / [F07](../chat-streaming-stop/ui.md) / [F17](../tool-confirmation-flow/ui.md) Esc precedence) | [tech-stack — UI Layer](../../../../standards/tech-stack.md#ui-layer), [NFR-USE-05](../../context.md#nfr-use-05) |
| Focus ring | Banner button `:focus-visible` outline using `var(--interactive-accent)`; zero colour literals | [tech-stack — UI Layer](../../../../standards/tech-stack.md#ui-layer), [code-style — Styling (Tailwind + Obsidian)](../../../../standards/code-style.md#styling-tailwind--obsidian) |
| Reduced motion | Badge mount/unmount fade and banner slide-in gated by `matchMedia("(prefers-reduced-motion: reduce)")`; when reduced: no fade, no slide — state swaps instantly; `data-visual-state` attrs and ARIA semantics are **not** stripped under reduced-motion | [tech-stack — UI Layer](../../../../standards/tech-stack.md#ui-layer), [NFR-USE-11](../../context.md#nfr-use-11) |
| Listeners | `useEffect` subscribe/unsubscribe on `PlanModeController.onModeChange`; hotkeys via `Plugin.registerDomEvent` auto-cleanup; command-palette entry auto-disposed by Obsidian on `onunload` | [code-style — React 18](../../../../standards/code-style.md#react-18), [code-style — Obsidian Plugin Patterns](../../../../standards/code-style.md#obsidian-plugin-patterns) |
| Structured logs | `logger.log("plan.mode.enter"\|"plan.mode.exit"\|"plan.mode.subagent-reject"\|"plan.mode.tool-blocked"\|"plan.attachment.queued"\|"plan.attachment.flushed"\|"plan.attachment.cleared-opposing"\|"plan.stale-todo.reminder"\|"plan.stale-todo.suppressed", {...})` via [F01 Logger](../plugin-bootstrap-logging/feature.md); reminder body and plan content never logged above `debug` | [architecture §3.1](../../../../architecture/architecture.md#31-ui-layer-react-mounted-inside-obsidian-views), [code-style — Logging](../../../../standards/code-style.md#logging), [NFR-LOG-04](../../context.md#nfr-log-04) |

## Back-link

[./feature.md](./feature.md)
