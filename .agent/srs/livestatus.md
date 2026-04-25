# Live Agent Status — Re-implementation Guide

Goal: render a chat transcript that streams an LLM agent's actions in real time —
assistant text, extended thinking, tool calls (with arguments + status spinner),
tool results (success / error / rejected / canceled), permission prompts, and
sub-agent progress. Stack-agnostic. Modeled on Claude Code's renderer.

You are getting only this doc. It is self-contained.

---

## 1. Mental Model

Three independent layers. Keep them separate or you will drown.

1. **Stream aggregator** — turns SDK streaming events into a growing
   `AssistantMessage` whose `content` array fills in over time. Pure data.
2. **Run state store** — global per-conversation state that tracks which
   `tool_use_id`s are currently *running*, which are *resolved*, which produced
   *progress* events, and which are *queued*. UI reads this.
3. **Renderers** — per-content-block React (or any reactive UI) components that
   look at (a) the block itself and (b) the run state store, and decide what to
   draw plus whether to animate.

The chat transcript is a flat list of "messages". Each message has a `uuid`,
a `role`, and a typed `content` array. Render messages top-to-bottom; the *last*
assistant message may still be growing.

---

## 2. Message Schema

Use a tagged-union. Every entry on the wire / in store has `type` + `uuid`.

```ts
type Message =
  | AssistantMessage
  | UserMessage
  | ProgressMessage      // ephemeral, not persisted in transcript history
  | SystemMessage        // local/system notices (errors, hook output, etc.)
  | AttachmentMessage    // images, file refs

type AssistantMessage = {
  type: 'assistant'
  uuid: string                     // local id, monotonically assigned
  apiMessageId?: string            // from Anthropic message_start
  status: 'streaming' | 'finished' | 'errored'
  stopReason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence'
  apiError?: 'max_output_tokens' | 'rate_limit' | 'context_overflow' | 'invalid_key' | string
  content: ContentBlock[]          // grows during streaming
  usage?: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }
}

type UserMessage = {
  type: 'user'
  uuid: string
  content: UserContentBlock[]      // text, image, tool_result
}

type ContentBlock =
  | { type: 'text';     text: string }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'redacted_thinking'; data: string }
  | { type: 'tool_use'; id: string; name: string; input: object }   // input arrives as streaming JSON
  | { type: 'tool_result'; tool_use_id: string; content: string | RichBlock[]; is_error?: boolean }
```

Block types map 1:1 to Anthropic API content block types. If your provider
differs, normalize at the aggregator boundary.

---

## 3. Stream Aggregator

Anthropic's streaming format (the reference):

| Event | When | Payload (what to keep) |
|---|---|---|
| `message_start`         | once at start | `message.id`, initial `usage` |
| `content_block_start`   | per block     | `index`, `content_block` (typed; tool_use has `id` + `name`, `input` empty) |
| `content_block_delta`   | per token     | `index`, `delta` — see below |
| `content_block_stop`    | per block     | `index` |
| `message_delta`         | mid/late      | `delta.stop_reason`, cumulative `usage` deltas |
| `message_stop`          | once at end   | finalize |

Delta sub-types:

- `text_delta`        → append `delta.text` to `content[index].text`
- `thinking_delta`    → append `delta.thinking`
- `signature_delta`   → set `content[index].signature` (extended thinking signature)
- `input_json_delta`  → append `delta.partial_json` to a *string buffer* per
  block; on `content_block_stop` parse it with `JSON.parse` into `input`.
  Tool inputs arrive as streamed JSON — they are not a valid object until stop.

Aggregator pseudocode:

```ts
function consume(stream, onUpdate) {
  const msg: AssistantMessage = { type:'assistant', uuid:newId(), status:'streaming', content:[], usage:zero() }
  const jsonBufs: Record<number,string> = {}

  for await (const ev of stream) {
    switch (ev.type) {
      case 'message_start':
        msg.apiMessageId = ev.message.id
        mergeUsage(msg.usage, ev.message.usage)
        break
      case 'content_block_start': {
        const b = ev.content_block
        msg.content[ev.index] =
          b.type === 'text'     ? { type:'text', text:'' } :
          b.type === 'thinking' ? { type:'thinking', thinking:'', signature:'' } :
          b.type === 'tool_use' ? { type:'tool_use', id:b.id, name:b.name, input:{} } :
          b.type === 'redacted_thinking' ? { type:'redacted_thinking', data:b.data } :
          b
        if (b.type === 'tool_use') jsonBufs[ev.index] = ''
        break
      }
      case 'content_block_delta': {
        const blk = msg.content[ev.index], d = ev.delta
        if (d.type === 'text_delta')        blk.text += d.text
        if (d.type === 'thinking_delta')    blk.thinking += d.thinking
        if (d.type === 'signature_delta')   blk.signature = d.signature
        if (d.type === 'input_json_delta')  jsonBufs[ev.index] += d.partial_json
        break
      }
      case 'content_block_stop': {
        const blk = msg.content[ev.index]
        if (blk.type === 'tool_use') {
          try { blk.input = JSON.parse(jsonBufs[ev.index] || '{}') }
          catch { blk.input = { __raw: jsonBufs[ev.index] } }
        }
        break
      }
      case 'message_delta':
        if (ev.delta.stop_reason) msg.stopReason = ev.delta.stop_reason
        mergeUsage(msg.usage, ev.usage)
        break
      case 'message_stop':
        msg.status = 'finished'
        break
    }
    onUpdate(msg) // emit on every event so UI re-renders
  }
}
```

Gotchas:

- `message_start.usage` may be partial. `message_delta.usage` is the full
  cumulative usage on each emission — *replace* don't add cache fields, but
  *do not overwrite a non-zero input_tokens with zero* (server sometimes sends 0).
- A single response may interleave `text` and `tool_use` blocks (also `thinking`
  before either). Index matters — order content by index.
- `redacted_thinking` blocks have no deltas — they arrive whole. Render as a
  closed/locked indicator; do not show contents.
- If the connection drops mid-stream, mark `status='errored'` and keep partial
  content. Do not silently truncate.

---

## 4. Run-State Store

Per conversation, maintain:

```ts
type RunState = {
  inProgressToolUseIds: Set<string>     // dispatched, not yet resolved
  resolvedToolUseIds:   Set<string>     // result received (success or error)
  erroredToolUseIds:    Set<string>     // subset of resolved
  rejectedToolUseIds:   Set<string>     // user denied permission, never ran
  canceledToolUseIds:   Set<string>     // user pressed Esc / aborted
  progressByToolUseId:  Map<string, ProgressEvent[]>
  permissionRequests:   Map<string, PermissionRequest>  // pending UI prompts
}
```

State machine for one tool_use:

```
queued ──dispatch──▶ in_progress ──result──▶ resolved (success | errored)
   │
   ├──user denies──▶ rejected
   └──user aborts──▶ canceled
```

The aggregator does *not* drive these transitions. Your tool runner does, by
calling store mutators (`markRunning(id)`, `markResolved(id, isError)`,
`appendProgress(id, ev)`, `markRejected(id)`, `markCanceled(id)`).

Renderers compute display status purely from the store + the tool_use block:

```ts
function statusOf(id) {
  if (rejectedToolUseIds.has(id)) return 'rejected'
  if (canceledToolUseIds.has(id)) return 'canceled'
  if (erroredToolUseIds.has(id))  return 'errored'
  if (resolvedToolUseIds.has(id)) return 'success'
  if (inProgressToolUseIds.has(id)) return 'running'
  return 'queued'
}
```

---

## 5. Progress Events

Tools emit progress mid-execution. Schema:

```ts
type ProgressEvent =
  | { kind:'bash';        toolUseId; stdout?:string; stderr?:string; exitCode?:number }
  | { kind:'web_search';  toolUseId; query:string; resultsSoFar:number }
  | { kind:'task_output'; toolUseId; status:string; taskId:string }
  | { kind:'mcp';         toolUseId; serverName:string; methodCall:string }
  | { kind:'agent';       toolUseId; agentId:string; agentType:string;
                          name?:string; toolUseCount:number; tokens?:number;
                          lastToolInfo?:string; isResolved?:boolean; isError?:boolean }
  | { kind:'skill';       toolUseId; skillName:string; status:string }
```

These are *not* persisted in transcript history. They live in the store, keyed
by `toolUseId`, and are rendered as ephemeral lines under the corresponding
tool-use block while it runs.

For sub-agent (`agent` kind): each tick replaces the prior state — show a tree
line "├─ <agentType> · <toolUseCount> tools · <tokens> tokens · <lastToolInfo>"
that updates in place.

---

## 6. Tool Registry & Display Contract

Each tool registers metadata. Renderers look up by `name`.

```ts
type ToolDef = {
  name: string
  userFacingName: (input:any) => string         // "Read", "Bash", "Edit (foo.ts)"
  isReadOnly?: boolean
  isTransparentWrapper?: boolean                // hide block from UI (e.g. internal wrapping tools)
  inputSchema: ZodLikeSchema                    // for safe parsing of partial input
  // Optional custom renderer for the args region
  renderToolUse?: (ctx: {
    block: ToolUseBlock
    parsedInput: unknown
    progress: ProgressEvent[]
    status: ToolStatus
  }) => UINode
  // Optional custom renderer for the result
  renderResult?: (ctx: {
    block: ToolResultBlock
    associatedToolUse: ToolUseBlock
  }) => UINode
}
```

Defaults if a tool ships no custom renderer:

- Header line: `<icon> <userFacingName(input)>` — bold while running, dim when
  queued, normal when resolved.
- Args region: collapsed JSON one-liner of `block.input` (truncate ~120 chars).
- Result region: monospace block of `tool_result.content`, truncated with
  "show more" toggle.

---

## 7. Per-Block Renderers

### 7.1 Text block (`AssistantTextMessage`)
- Render `text` through a Markdown renderer.
- Streaming: re-render on every aggregator update. The block's `text` grows;
  let your diff/reconciler handle it.
- Show a soft cursor (`▍` or `●`) at the tail while the parent message has
  `status==='streaming'` AND this is the *last* content block.

### 7.2 Thinking block (`AssistantThinkingMessage`)
- Visually distinct (italic, dim, border, "Thinking" label).
- Collapsible. Default: collapsed once finalized; expanded while streaming.
- For `redacted_thinking`: render only "Redacted thinking · (n bytes)" — never
  display the opaque `data`.

### 7.3 Tool-use block (`AssistantToolUseMessage`)
The most complex. Layout:

```
<status-glyph> <tool-name>(<short-args>)        ← header line
  └─ <progress lines, if any>                    ← streamed updates
  └─ <permission prompt, if pending>             ← inline modal
  └─ <result, when resolved>                     ← from associated tool_result block
```

Status glyph (the `ToolUseLoader`):

| Status     | Glyph                | Color   | Animation         |
|------------|----------------------|---------|-------------------|
| queued     | `●` dim              | dim     | none              |
| running    | `●` blinking / space | none    | blink ~2 Hz       |
| success    | `●`                  | green   | none              |
| errored    | `●`                  | red     | none              |
| rejected   | `●`                  | yellow  | none              |
| canceled   | `●`                  | gray    | strike-through    |

Blink implementation: a `useBlink(active)` hook that toggles a boolean on a
500 ms interval and returns `[ref, isOn]`. The glyph is rendered as `●` when
`isOn` is true and as a *space* when false (same width — no layout jitter).

Caveat from the original: in terminal renderers, do not place `<dim>x</dim>`
immediately followed by `<bold>y</bold>` — the SGR reset code `\x1b[22m` resets
both. The tool name will inherit the blink. Either separate with a non-styled
character or render dim + bold via separate spans with explicit color resets.
Same caveat applies anywhere blink/dim toggles sit beside other styled spans.

Args rendering:
- Parse `block.input` with the tool's schema. If parse fails (still streaming
  partial JSON or schema mismatch), show `…` placeholder.
- Tools may opt into a custom renderer (e.g. file edit shows a unified diff;
  web search shows the query and a result count).

Grouping (`GroupedToolUseContent`, `CollapsedReadSearchContent`):
- Adjacent tool-use blocks of the *same* read-only tool (e.g. multiple `Read`s
  or `Grep`s) collapse into a single expandable group ("Read 4 files ▸"). Only
  group when *all* are resolved successfully.
- Never collapse running/errored/rejected tool uses.

### 7.4 Tool-result block (user role)
Render *attached* to its tool-use block (look up by `tool_use_id`), not as a
standalone bubble. Per status:

- success: small monospace box; if very long, collapsed by default.
- errored: red border, full content shown, "Tool error" label.
- rejected: gray, "Rejected by user" + reason if any. (`UserToolRejectMessage`)
- canceled: gray, "Canceled" + ⎋ key hint.
- For file-edit tools: render structured diff (unified, +/- lines, syntax
  highlighting) — this is the single biggest UX upgrade vs. raw text.

### 7.5 Sub-agent progress (`AgentProgressLine`)
For `agent`-kind progress events, draw a tree under the parent tool-use:

```
└─ <agentType> · <toolCount> tools · <tokens>
   └─ <lastToolInfo or "Initializing…" or "Done">
```

Use `└─` for last child, `├─` otherwise. Replace the "Initializing…" placeholder
once the first real `lastToolInfo` arrives. On `isResolved=true`, freeze as
"Done" (or "Running in the background" for async agents).

### 7.6 System / error messages
- `RateLimitMessage` — usage banner with reset time.
- `SystemAPIErrorMessage` — yellow/red banner; quote the API error verbatim.
- `CompactBoundaryMessage` — visual divider for context compaction events.
- `HookProgressMessage` — for user-configured hooks; render dim, prefixed
  `[hook]`.

---

## 8. Bottom-of-Chat Live Indicator

A persistent line below the transcript that summarizes the agent's *current*
activity. Subscribe to:

- `assistantMessage.status` of the last message
- `runState.inProgressToolUseIds`

Logic:

```
if any tool running:           "Running <tool.userFacingName> · <elapsed>"
elif assistant streaming text: "Thinking…" (shimmer)
elif assistant streaming thnk: "Reasoning…"
else:                          hide
```

Add a stalled-detector: if no event for >10 s, switch label to
`"Working… (no output for {elapsed}s)"`. Press Esc to abort → fires
`markCanceled` on every in-progress tool_use_id and aborts the stream.

Animations:
- **Blink** — boolean toggle on 500 ms interval (used for tool glyph).
- **Shimmer** — animated gradient over text (used for "Thinking…" label).
  Implement as a moving highlight index over the chars; advance ~12 fps.
- **Spinner** — rotating glyph from a frame array
  (`['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏']`), advance ~10 fps.

If you cannot animate (e.g. plain logs), drop frames silently — never let
animation bugs block content updates.

---

## 9. Permission Prompts (inline)

When the runtime needs user approval before dispatching a tool:

1. Tool runner calls `requestPermission(toolUseId, toolName, input)` and *suspends*.
2. Store records a `PermissionRequest`.
3. Renderer for the tool-use block, on seeing a pending request for its id,
   shows an inline prompt *above* the args:

   ```
   ⚠ Allow Bash to run `rm -rf node_modules`?
       [y] Yes, once   [a] Always for this command   [n] No
   ```

4. User answer mutates the store: approval → call `markRunning` and continue;
   denial → call `markRejected`, runner returns a rejection result block.

The prompt is *part of* the tool-use rendering, not a separate modal — that way
when the user scrolls back, they see the prompt-in-context and the decision
made. Persist `decision` on resolution.

---

## 10. Concrete Data Flow (example)

User asks: "List repo files then read README".

```
1. User submits → UserMessage appended.
2. Stream opens. Aggregator starts emitting AssistantMessage updates.
3. content[0] = thinking block fills…           → ThinkingRenderer streams
4. content[1] = text "I'll list files first."   → TextRenderer streams
5. content[2] = tool_use {name:'Bash',
                          input:{cmd:'ls'}}
   - status=queued (just appeared)
   - dispatcher calls markRunning('id1')        → glyph blinks
   - bash emits stdout progress events          → progress lines render
   - dispatcher receives result → markResolved  → glyph green
   - UserMessage with tool_result appended      → result panel mounts
6. message_stop → status='finished', stopReason='tool_use'
7. Runtime auto-issues next request with tool_result included.
8. Repeat for Read tool…
9. Final assistant turn ends with stopReason='end_turn'.
```

Renderers receive store + message updates and re-render. They never wait on
each other.

---

## 11. Performance Notes

- Virtualize the transcript (windowed list). Only the last ~50 messages need
  to be live; older ones render once and freeze.
- Memoize per-block renderers by `(block, status)`. The original Claude Code
  uses the React Compiler's auto-memo cache (`_c(n)`) — same idea: hash inputs,
  reuse output node.
- During a delta storm, coalesce updates with `requestAnimationFrame` (web) or
  a 16 ms debounce (terminal). Streaming text at 200 tok/s × 1 render/token
  will burn CPU.
- Keep the run-state store separate from the message list. Otherwise every
  status change re-renders every message.

---

## 12. Persistence & Replay

When you save a conversation:

- Persist messages with `content`, `status`, `stopReason`, `usage`.
- Persist tool_use *results* as separate UserMessage entries (they are part of
  the API conversation history anyway).
- Do **not** persist `ProgressEvent`s — they are ephemeral.
- Do **not** persist `inProgressToolUseIds` — at load time everything is either
  resolved or it was canceled by interruption (mark all unresolved tool_uses as
  `canceled` on resume).

Replay is just: render the persisted message list with an empty run-state
store. The `statusOf()` function still works because every persisted tool_use
has a corresponding tool_result (or a "canceled" marker).

---

## 13. Minimum-Viable Build Order

If you implement this from scratch, in this order you have something usable
fastest:

1. Aggregator + flat transcript with **text only**. (Verify streaming works.)
2. Add **tool_use** + **tool_result** blocks with a default JSON renderer.
3. Add the **run-state store** and the **status glyph** (blink animation).
4. Add **progress events** for bash (the highest-value tool).
5. Add **permission prompts**.
6. Add **thinking** blocks.
7. Add **tool-specific renderers** (file diff, web search, etc.).
8. Add **grouping/collapsing** for read-only tools.
9. Add **sub-agent tree** rendering.
10. Add **bottom-of-chat live indicator** with stalled detection.

Stop after step 4 if you are time-boxed — that is already a working live agent
chat.

---

## 14. Edge Cases You Will Hit

- **Empty content array** on `message_stop`: rare, but possible if the model
  errors immediately. Render a system error inline.
- **Tool result before tool_use finalizes**: don't happen with Anthropic's API
  (tool_use must finalize first), but defensively render a placeholder if your
  store ever sees this ordering.
- **Duplicate tool_use_id**: never reuse ids. Treat duplicates as a bug,
  surface a system warning.
- **Very long tool results** (e.g. 10 MB log): truncate to ~8 KB for display,
  keep full content addressable via "expand" or external file ref.
- **Unicode in deltas split across packets**: aggregator must concatenate raw
  bytes/strings — never decode-then-concat per chunk. Anthropic emits valid
  UTF-8 deltas already, but if you proxy, watch this.
- **Stream cancel**: on user abort, send a cancel signal upstream, mark the
  current assistant message `status='errored'` with a sentinel, mark all
  in-progress tool_uses canceled, finalize whatever content arrived.
- **Reconnect mid-tool**: the previous tool_use has no result. On resume, send
  a synthetic tool_result `{is_error:true, content:'(interrupted)'}` to keep
  API conversation history valid.

---

## 15. Style Cheatsheet (for terminal UIs)

| Element            | Style                           |
|--------------------|---------------------------------|
| Assistant text     | default fg                      |
| Thinking text      | dim italic                      |
| Tool name          | bold                            |
| Tool args          | dim                             |
| Running glyph      | bold, blinking via space-swap   |
| Success glyph      | green ●                         |
| Error glyph/text   | red                             |
| Rejected           | yellow                          |
| Canceled           | gray, strike-through            |
| Progress lines     | dim, prefixed `└─`              |
| Sub-agent tree     | dim, `├─`/`└─` connectors       |
| Permission prompt  | yellow border, bold question    |
| System banner      | yellow/red full-width           |

For web UIs, map these to your design tokens — the semantics are what matters.

---

## 16. Reference Glyphs

- `●` U+25CF BLACK_CIRCLE — primary status glyph (preferred over spinner frames
  for tool-use status, because the position never moves; only color/blink).
- `└─` U+2514 U+2500 — last tree connector.
- `├─` U+251C U+2500 — non-last tree connector.
- `…` U+2026 — truncation / "Initializing…" / "Thinking…".
- `▍` U+258D — streaming text cursor.
- Braille spinner frames (10): `⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏`.

---

## 17. What This Doc Deliberately Skips

- Auth, session management, transcript persistence schemas, model selection,
  cost tracking — orthogonal to live status rendering.
- The exact React/Ink wiring — this is a contract doc, not a port.
- Specific tool implementations (bash sandboxing, file edit semantics) — those
  belong in their own docs. Here we only describe how their *progress and
  results* surface in chat.

If your re-implementation honors §2 (schema), §3 (aggregator), §4 (run state),
§7 (per-block renderers) and §8 (live indicator), the rest is taste.
