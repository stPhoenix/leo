# ToolSearch — Implementation Guide

A guide for porting the **ToolSearch** mechanism (deferred tool loading + on-demand schema discovery) into another Claude-API-driven agent harness.

ToolSearch lets you keep a large pool of tools (typically MCP tools) registered with the model **without sending their full JSON schemas in every request**. Instead, the model only sees their _names_, and pulls in full schemas on demand via a built-in meta-tool. This dramatically reduces tools-block size in the system prompt — important when you have hundreds of MCP tools whose definitions can otherwise dominate the context window.

---

## 1. The mental model

There are three layers:

1. **Deferred tool registration.** When sending tool definitions to the Anthropic Messages API, mark some tools with `defer_loading: true`. The API accepts these but does **not** include their full schemas in the model's prompt — only their names appear in a `<system-reminder>` (or pre-prepended `<available-deferred-tools>`) block.
2. **The `ToolSearch` meta-tool.** A normal tool you register on every request. Its job is to take a query string and return matching deferred tools, where the _result_ expands into full tool schemas inside a `<functions>` block in the model's prompt.
3. **Discovery tracking.** Once the model has called ToolSearch and the API has expanded a `tool_reference` block in the response history, that tool's full schema is now visible to the model. Your harness scans message history for these `tool_reference` blocks and on subsequent API calls only includes those discovered deferred tools (full schema, no `defer_loading`) plus all non-deferred tools and ToolSearch itself.

Net effect: the initial prompt is small. The model lazily expands tools it actually needs. The expanded set persists across turns.

---

## 2. Wire-level requirements

### 2.1 Beta header

`defer_loading` and `tool_reference` are beta API features. Send the appropriate beta header on every request that uses tool search:

| Provider                                  | Beta header                    |
| ----------------------------------------- | ------------------------------ |
| First-party (api.anthropic.com) / Foundry | `advanced-tool-use-2025-11-20` |
| Third-party (Vertex, Bedrock, proxies)    | `tool-search-tool-2025-10-19`  |

For Bedrock the header goes into `extraBodyParams` rather than the `betas` array. For Vertex/Foundry it goes into `betas` like usual.

### 2.2 Tool definition shape

Standard Anthropic tool definition with one extra field:

```json
{
  "name": "mcp__slack__post_message",
  "description": "...",
  "input_schema": { ... },
  "defer_loading": true
}
```

Build a small helper that copies your cached base schema and adds `defer_loading: true` per-request when needed (cache_control behaves the same way). Do **not** mutate the cached base; the deferral decision can vary per call.

When a tool is sent with `defer_loading: true`:

- The API does **not** count it against your tools-block tokens in the model's view.
- The model sees only its name in a system reminder.
- The model cannot invoke it directly — calling it without first running ToolSearch returns an `InputValidationError`.

### 2.3 Model compatibility

`tool_reference` blocks are **not supported by Haiku models** at the time of writing. Negative test recommended: assume any model supports it _unless_ its name contains a known unsupported substring (default: `["haiku"]`). Allow this list to be configured. If unsupported, fall back to standard mode (no deferral) for that request.

### 2.4 Proxy compatibility

If `ANTHROPIC_BASE_URL` points to a non-first-party host (a proxy), `tool_reference` may be rejected. Recommended: disable tool search by default in that case, but allow an explicit env var (`ENABLE_TOOL_SEARCH=true|auto|auto:N`) to assert the proxy supports it. Also expose a kill-switch env var (`CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`) that forces standard mode globally.

---

## 3. The ToolSearch tool itself

### 3.1 Identity

```
name:        ToolSearch
input:       { query: string, max_results?: number = 5 }
output:      { matches: string[], query, total_deferred_tools, pending_mcp_servers? }
isReadOnly:  true
isConcurrencySafe: true
```

ToolSearch is **never** itself deferred — the model needs it on turn 1 to load anything else. Likewise the agent-spawning tool, your communication-channel tool, and any tool whose prompt body the model must see immediately should also bypass deferral.

### 3.2 Description shown to the model

Use this exact (or equivalent) description as the tool's prompt body — the keywords here are what the model has been trained against:

```
Fetches full schema definitions for deferred tools so they can be called.

Deferred tools appear by name in <system-reminder> messages. Until fetched,
only the name is known — there is no parameter schema, so the tool cannot be
invoked. This tool takes a query, matches it against the deferred tool list,
and returns the matched tools' complete JSONSchema definitions inside a
<functions> block. Once a tool's schema appears in that result, it is callable
exactly like any tool defined at the top of the prompt.

Result format: each matched tool appears as one
<function>{"description": "...", "name": "...", "parameters": {...}}</function>
line inside the <functions> block — the same encoding as the tool list at the
top of the prompt.

Query forms:
- "select:Read,Edit,Grep" — fetch these exact tools by name
- "notebook jupyter" — keyword search, up to max_results best matches
- "+slack send" — require "slack" in the name, rank by remaining terms
```

If you announce deferred tools via a different mechanism (e.g. a one-shot pre-prepended `<available-deferred-tools>` block instead of attachment-driven `<system-reminder>` deltas), swap that line in the description.

### 3.3 Input schema

```ts
z.object({
  query: z
    .string()
    .describe(
      'Query to find deferred tools. Use "select:<tool_name>" for direct selection, or keywords to search.',
    ),
  max_results: z
    .number()
    .optional()
    .default(5)
    .describe('Maximum number of results to return (default: 5)'),
});
```

### 3.4 Output → tool result conversion

This is the load-bearing trick. ToolSearch returns its result as a `tool_result` block whose `content` is an **array of `tool_reference` blocks**, not text:

```json
{
  "type": "tool_result",
  "tool_use_id": "<id>",
  "content": [
    { "type": "tool_reference", "tool_name": "mcp__slack__post_message" },
    { "type": "tool_reference", "tool_name": "mcp__slack__list_channels" }
  ]
}
```

The Anthropic API expands each `tool_reference` server-side into a full `<function>{...}</function>` line inside a `<functions>` block in the model's prompt — this is what makes the tool callable.

If `matches` is empty, return a plain text result instead, optionally noting any pending MCP servers:

```
"No matching deferred tools found. Some MCP servers are still connecting:
slack, github. Their tools will become available shortly — try searching again."
```

The SDK's TS types may not include `tool_reference` yet — cast through `unknown` if needed. Bedrock/Vertex may not support client-side expansion of `tool_reference` — the format above is verified for first-party and Foundry.

---

## 4. Query parsing & search algorithm

The `query` field has three modes. Try them in order:

### 4.1 `select:` prefix — direct selection

Match `^select:(.+)$` (case-insensitive). Split the captured group on `,`, trim, drop empties. For each name:

- First look in the deferred tool set.
- If absent, look in the full tool set — **return success anyway**. The tool is already loaded; "selecting" it is a harmless no-op that lets the model proceed without retry churn.
- Track names not found anywhere as `missing` for logging only.

If at least one was found, return the found list. If none were found, return empty matches (with optional `pending_mcp_servers` info).

### 4.2 Exact match fast path

If the entire query (lowercased, trimmed) equals a tool name (lowercased), return just that tool. Catches the common case of subagents or post-compaction models passing a bare name without `select:`.

### 4.3 MCP prefix shortcut

If the query starts with `mcp__` and is longer than 5 chars, return up to `max_results` deferred tools whose lowercase name starts with the query. Lets the model pull "everything from this MCP server" by name.

### 4.4 Keyword search (the general case)

Tokenize `query.toLowerCase()` on whitespace. Partition tokens:

- Tokens starting with `+` (and length > 1) → **required terms** (strip the `+`).
- All others → **optional terms**.

If any required terms exist: pre-filter to tools that match **all** of them (in name parts, in description, or in `searchHint`). The combined scoring set is `[...required, ...optional]`. Otherwise, score against all query tokens.

For each candidate tool, parse its name into parts:

- **MCP tools** (`mcp__server__action`): strip `mcp__` prefix; split on `__` then on `_`; lowercase. `isMcp = true`. `full = parts joined by space`.
- **Regular tools** (CamelCase): insert a space between `[a-z][A-Z]` boundaries, replace `_` with space, lowercase, split on whitespace. `isMcp = false`.

Then for each scoring term, accumulate score:

| Match site                                            | Weight (regular) | Weight (MCP) |
| ----------------------------------------------------- | ---------------- | ------------ |
| Exact word in name parts (`parts.includes(term)`)     | 10               | 12           |
| Substring of any name part                            | 5                | 6            |
| Substring of `full` name _(only if score is still 0)_ | 3                | 3            |
| Word-boundary match in `searchHint`                   | 4                | 4            |
| Word-boundary match in tool description               | 2                | 2            |

Use word-boundary regex (`\b<escaped-term>\b`) for description and searchHint matches to avoid false positives. Pre-compile once per search rather than per (tool × term).

Drop zero-score tools, sort descending by score, return top `max_results` names.

### 4.5 Tool description caching

Resolving each tool's description (its prompt body) can be expensive — memoize by tool name. **Invalidate the cache whenever the deferred-tool set changes** (e.g. an MCP server connects or disconnects). A simple invalidation key: sorted concatenation of deferred tool names. When the key differs from the last seen key, clear the cache and store the new key.

---

## 5. Marking tools as deferred

Per-tool, decide deferral with this priority order (first match wins):

1. `tool.alwaysLoad === true` → **never deferred**. For MCP tools, drive this from the tool's `_meta['anthropic/alwaysLoad']` field. Use for tools the model must see on turn 1.
2. `tool.name === "ToolSearch"` → never deferred (it's the discovery tool).
3. Other always-on protocol tools (your agent-spawn tool, communication channels, etc.) → never deferred.
4. `tool.isMcp === true` → deferred by default (MCP tools are workflow-specific and usually numerous).
5. `tool.shouldDefer === true` → deferred (manual opt-in for non-MCP tools).
6. Otherwise → not deferred.

### 5.1 Optional tool fields to add

```ts
interface Tool {
  // ... existing fields ...
  isMcp?: boolean;
  shouldDefer?: boolean; // opt-in deferral for non-MCP tools
  alwaysLoad?: boolean; // hard opt-out
  searchHint?: string; // 3–10 word capability phrase used by ToolSearch keyword scoring.
  //   Prefer terms NOT already in the tool name, e.g. "jupyter" for NotebookEdit.
}
```

---

## 6. Per-request flow

When tool search is enabled for a request:

1. **Compute the deferred set.** Apply the rules from §5 to your full tool list.
2. **Extract the discovered set.** Walk the message history (see §7) and collect tool names from any `tool_reference` blocks the API has previously expanded.
3. **Filter the tools you actually send.** For each tool:
   - If not deferred → include with full schema.
   - If it is `ToolSearch` itself → include with full schema (always).
   - If deferred AND in the discovered set → include with full schema (no `defer_loading`).
   - If deferred AND not yet discovered → include with `defer_loading: true`.
4. **Add the beta header** (§2.1).
5. **Announce deferred tool names to the model.** Either:
   - **Delta mode** — append a `<system-reminder>` attachment whenever the deferred tool pool changes (added/removed names). Track previously-announced names by scanning attachments in history; only emit a delta when there's a real change. This is the modern path.
   - **Header mode** — prepend a `<available-deferred-tools>` block listing all currently-deferred names on each call. Simpler but redundant.

In either mode the line format per tool is just the tool name. Search-hint A/B testing showed no benefit from rendering hints in this list.

---

## 7. Discovery tracking

To know which deferred tools the model has already pulled in, scan the conversation's message history every turn:

```
For each user message:
  For each block in message.content (if array):
    If block.type === 'tool_result' AND block.content is an array:
      For each item in block.content:
        If item.type === 'tool_reference' AND typeof item.tool_name === 'string':
          discoveredTools.add(item.tool_name)
```

Also handle compaction: when the harness compacts older messages, the `tool_reference`-bearing messages may be replaced with a summary marker. Snapshot the pre-compact discovered set onto the boundary marker (`compactMetadata.preCompactDiscoveredTools`) so the next scan can read it back. Or, alternatively, exclude `tool_reference`-bearing messages from compaction.

When deduping or hashing the tools array (e.g. for prompt-cache keying), exclude tools that have `defer_loading: true` — the API strips them from the cached portion anyway.

---

## 8. Mode selection (recommended)

Expose three modes and let users select via env var `ENABLE_TOOL_SEARCH`:

| `ENABLE_TOOL_SEARCH` | Mode       | Behavior                                                                      |
| -------------------- | ---------- | ----------------------------------------------------------------------------- |
| `true` / `auto:0`    | `tst`      | Always defer (MCP + `shouldDefer`).                                           |
| `auto` / `auto:N`    | `tst-auto` | Defer only when deferred-tool definitions exceed N% of context (default 10%). |
| `false` / `auto:100` | `standard` | Disable tool search; send all tools inline.                                   |
| (unset)              | `tst`      | Default: defer.                                                               |

For `tst-auto`: try the Messages API token-counting endpoint first (cached, one call per toolset change); fall back to a `chars × 2.5 ≈ tokens` heuristic if it fails. Threshold = `contextWindow × percentage`.

Also disable when:

- The model doesn't support `tool_reference` (§2.3).
- `ToolSearch` itself has been disallowed (e.g. via a user `disallowedTools` list).
- `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` is truthy.

---

## 9. Edge cases worth handling

- **Pending MCP connections.** If MCP servers are still handshaking when ToolSearch runs, include their names under `pending_mcp_servers` in the result and tell the model to retry shortly. Otherwise the model gives up after one empty match.
- **Subagents / post-compaction.** Models occasionally call ToolSearch with a bare tool name instead of `select:Name`. The exact-match fast path (§4.2) covers this.
- **Already-loaded tool in `select:`.** Treat as success (no-op) rather than an error, so the model can proceed if it accidentally selects something that's already in the prompt.
- **Tool prompt errors during scoring.** If a tool's `prompt()` throws or returns empty, treat its description as the empty string — don't fail the whole search.
- **Stale `searchHint`.** Keep hints to 3–10 words, no period; cache invalidates with the description.

---

## 10. Minimal implementation checklist

- [ ] Extend tool definition type with `isMcp`, `shouldDefer`, `alwaysLoad`, `searchHint`.
- [ ] Extend the API tool-schema builder to optionally emit `defer_loading: true`.
- [ ] Add the appropriate beta header to outgoing requests.
- [ ] Implement `isDeferredTool()` per the rules in §5.
- [ ] Register a built-in `ToolSearch` tool with the schema in §3 and the algorithm in §4.
- [ ] Implement `tool_result` → `tool_reference[]` conversion in the result mapper.
- [ ] Implement `extractDiscoveredToolNames(messages)` per §7.
- [ ] In the per-request tool-list builder, use the discovered set to decide which deferred tools to expand (§6 step 3).
- [ ] Announce deferred tool names to the model via attachment delta or pre-prepended block (§6 step 5).
- [ ] Handle the compaction snapshot so discovery survives across compact boundaries (§7).
- [ ] Add the `ENABLE_TOOL_SEARCH` env var with `tst` / `tst-auto` / `standard` modes (§8).
- [ ] Skip tool search for unsupported models (default: any name containing `haiku`).
- [ ] Memoize tool descriptions in ToolSearch keyword scoring; invalidate when deferred set changes.

---

## 11. Reference: example end-to-end turn

1. User starts session. Harness builds tool list: 5 core tools + 200 MCP tools.
2. Harness sends first request: 5 core tools + `ToolSearch` with full schemas; 200 MCP tools sent with `defer_loading: true`. Beta header set. A `<system-reminder>` lists the 200 deferred names.
3. Model wants to post to Slack. It calls `ToolSearch({ query: "slack post" })`.
4. ToolSearch keyword search scores every deferred tool, returns top 5: `["mcp__slack__post_message", "mcp__slack__update_message", ...]`.
5. Result mapper returns a `tool_result` whose `content` is 5 `tool_reference` blocks. The API expands them into full `<function>` definitions in the model's next prompt.
6. Model calls `mcp__slack__post_message(...)` directly.
7. On the next request, harness scans history, finds `tool_reference` blocks for those 5 names, and includes them with full schemas (no `defer_loading`). The other 195 MCP tools stay deferred. ToolSearch and core tools always included.
8. Repeat. Discovered set monotonically grows over the session, surviving compaction via the boundary snapshot.
