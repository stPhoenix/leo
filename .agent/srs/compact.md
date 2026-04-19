# Context Compaction System - Full Specification

This document specifies the context compaction system used to manage conversation context
within a fixed token window. It is written so that a developer on any tech stack can
implement the same behavior.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Constants and Thresholds](#3-constants-and-thresholds)
4. [Token Counting](#4-token-counting)
5. [Layer 1: Microcompaction](#5-layer-1-microcompaction)
6. [Layer 2: Autocompaction](#6-layer-2-autocompaction)
7. [Layer 3: Full Conversation Compaction](#7-layer-3-full-conversation-compaction)
8. [Layer 4: Session Memory Compaction](#8-layer-4-session-memory-compaction)
9. [Partial Compaction](#9-partial-compaction)
10. [Summarization Prompts](#10-summarization-prompts)
11. [Post-Compaction Message Assembly](#11-post-compaction-message-assembly)
12. [Post-Compaction Cleanup](#12-post-compaction-cleanup)
13. [Prompt-Too-Long Recovery](#13-prompt-too-long-recovery)
14. [Message Grouping](#14-message-grouping)
15. [API Invariant Preservation](#15-api-invariant-preservation)
16. [Hooks Integration](#16-hooks-integration)
17. [Telemetry Events](#17-telemetry-events)
18. [Environment Variable Overrides](#18-environment-variable-overrides)
19. [Feature Flags](#19-feature-flags)
20. [Error Handling](#20-error-handling)

---

## 1. Overview

The compaction system prevents conversations from exceeding the model's context window. It
operates as a multi-layered pipeline, from lightweight token pruning to full conversation
summarization via a secondary LLM call.

**Design goals:**
- Never lose critical context (user intent, recent work, pending tasks)
- Minimize cost (prefer cheap pruning over expensive summarization)
- Preserve prompt cache when possible (avoid invalidating server-side cached prefixes)
- Maintain API invariants (tool_use/tool_result pairing, message ordering)
- Fail gracefully with circuit breakers and retry logic

**Execution order in the query loop:**

```
1. History snip (optional, removes old messages)
2. Microcompaction (lightweight token pruning, pre-API)
3. Context collapse (optional, granular compression)
4. Autocompaction (threshold-based full summarization)
5. API call to model
6. Post-compact cleanup (cache invalidation)
```

---

## 2. Architecture

### Message Types

The system uses special message types as boundary markers:

#### SystemCompactBoundaryMessage

Inserted at the compaction point. All messages before this marker have been summarized.

```typescript
{
  type: "system",
  subtype: "compact_boundary",
  compact_metadata: {
    trigger: "manual" | "auto",
    pre_tokens: number,              // token count before compaction
    preserved_segment?: {            // present when messagesToKeep exists
      head_uuid: UUID,               // first preserved message
      anchor_uuid: UUID,             // message immediately before preserved segment
      tail_uuid: UUID,               // last preserved message
    },
    pre_compact_discovered_tools?: string[],  // tool names loaded pre-compact
  },
  uuid: UUID,
  session_id: string,
}
```

#### Summary Message

A user message containing the formatted summary. Marked with metadata flags:

```typescript
{
  type: "user",
  content: string,                   // formatted summary text
  isCompactSummary: true,
  isVisibleInTranscriptOnly: true,   // hidden from UI, visible in saved transcript
}
```

#### SystemMicrocompactBoundaryMessage

Marks a microcompaction event (tool result content clearing).

### CompactionResult

The output of any compaction operation:

```typescript
interface CompactionResult {
  boundaryMarker: SystemMessage           // compact boundary marker
  summaryMessages: UserMessage[]          // summary of compacted content
  attachments: AttachmentMessage[]        // file restorations, tool re-announcements
  hookResults: HookResultMessage[]        // session start hook outputs
  messagesToKeep?: Message[]              // preserved messages (partial/SM compact)
  userDisplayMessage?: string             // UI feedback text
  preCompactTokenCount?: number           // tokens before compaction
  postCompactTokenCount?: number          // compact API call's total usage
  truePostCompactTokenCount?: number      // estimated resulting context size
  compactionUsage?: TokenUsage            // detailed API token breakdown
}
```

---

## 3. Constants and Thresholds

### Context Window

| Constant | Value | Description |
|----------|-------|-------------|
| `MODEL_CONTEXT_WINDOW_DEFAULT` | 200,000 | Default context window when model capability is unknown |
| `COMPACT_MAX_OUTPUT_TOKENS` | 20,000 | Max output tokens reserved for the summarization API call |
| `MAX_OUTPUT_TOKENS_DEFAULT` | 32,000 | Default max output for regular queries |
| `MAX_OUTPUT_TOKENS_UPPER_LIMIT` | 64,000 | Upper limit for max output tokens |

### Compaction Thresholds

| Constant | Value | Description |
|----------|-------|-------------|
| `AUTOCOMPACT_BUFFER_TOKENS` | 13,000 | Buffer before autocompact triggers |
| `WARNING_THRESHOLD_BUFFER_TOKENS` | 20,000 | Buffer before warning UI appears |
| `ERROR_THRESHOLD_BUFFER_TOKENS` | 20,000 | Buffer before error UI appears |
| `MANUAL_COMPACT_BUFFER_TOKENS` | 3,000 | Buffer for manual /compact blocking limit |
| `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES` | 3 | Circuit breaker: stop after N failures |

### Post-Compaction Budgets

| Constant | Value | Description |
|----------|-------|-------------|
| `POST_COMPACT_MAX_FILES_TO_RESTORE` | 5 | Max recently-read files re-attached |
| `POST_COMPACT_TOKEN_BUDGET` | 50,000 | Total token budget for all attachments |
| `POST_COMPACT_MAX_TOKENS_PER_FILE` | 5,000 | Max tokens per restored file |
| `POST_COMPACT_MAX_TOKENS_PER_SKILL` | 5,000 | Max tokens per invoked skill |
| `POST_COMPACT_SKILLS_TOKEN_BUDGET` | 25,000 | Total budget for skill attachments |

### Session Memory Compaction

| Constant | Value | Description |
|----------|-------|-------------|
| `minTokens` | 10,000 | Minimum tokens to preserve after compaction |
| `minTextBlockMessages` | 5 | Minimum messages with text blocks to keep |
| `maxTokens` | 40,000 | Maximum tokens to preserve (hard cap) |

### Retry and Streaming

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_COMPACT_STREAMING_RETRIES` | 2 | Retry attempts for streaming fallback |
| `MAX_PTL_RETRIES` | 3 | Max prompt-too-long truncation retries |
| `IMAGE_MAX_TOKEN_SIZE` | 2,000 | Estimated tokens per image/document |

### Threshold Calculations

```
effectiveContextWindow = contextWindow - min(maxOutputTokensForModel, 20_000)
autoCompactThreshold = effectiveContextWindow - 13_000
warningThreshold = autoCompactThreshold - 20_000
errorThreshold = autoCompactThreshold - 20_000
blockingLimit = effectiveContextWindow - 3_000
```

The `contextWindow` is resolved in this priority order:
1. Environment variable `CLAUDE_CODE_MAX_CONTEXT_TOKENS`
2. Model string `[1m]` suffix -> 1,000,000
3. Model capability metadata (max_input_tokens)
4. Beta headers for 1M context
5. Default: 200,000

---

## 4. Token Counting

Three tiers of token estimation, from most to least accurate:

### Tier 1: API Usage (post-call)

Read from the API response's `usage` field. This is the only authoritative count.

### Tier 2: Hybrid Estimation (pre-call)

`tokenCountWithEstimation(messages)`:
- Walk backwards to find the last API response that has `usage.input_tokens`
- Use that as a base
- Estimate tokens added since that response
- Works during streaming

### Tier 3: Rough Estimation

`roughTokenCountEstimation(content, bytesPerToken = 4)`:

```
return Math.round(content.length / bytesPerToken)
```

### Message-Level Estimation

`estimateMessageTokens(messages)`:

For each message block:
- `text` blocks: `roughTokenCountEstimation(text)`
- `image` / `document` blocks: 2,000 tokens each
- `tool_result` blocks: sum of content items using same rules
- `thinking` blocks: `roughTokenCountEstimation(thinkingText)` (text only, not wrapper)
- `tool_use` blocks: `roughTokenCountEstimation(name + JSON(input))`
- Other blocks (server_tool_use, etc.): `roughTokenCountEstimation(JSON(block))`

**Final step: multiply total by 4/3 (conservative padding).**

---

## 5. Layer 1: Microcompaction

Microcompaction reduces token usage **before** the API call by clearing old tool result
content, without summarization.

### Entry Point

```
microcompactMessages(messages, toolUseContext?, querySource?) -> MicrocompactResult
```

### Compactable Tools

Only tool results from these tools are eligible for clearing:

- FileRead
- Bash / PowerShell / PowerShell ISE (all shell tools)
- Grep
- Glob
- WebSearch
- WebFetch
- FileEdit
- FileWrite

### Path A: Time-Based Microcompaction

**Trigger condition:** Gap since last assistant message exceeds `gapThresholdMinutes`
(default: 60 minutes). This means the server-side prompt cache has almost certainly expired.

**Behavior:**
1. Collect all compactable tool_use IDs from assistant messages (in order)
2. Keep the last N IDs (default: `keepRecent = 5`, minimum 1)
3. For all older tool results, replace content with `"[Old tool result content cleared]"`
4. Calculate tokens saved
5. If no tokens saved, return null (fall through)
6. Reset cached microcompact state (invalidated by content change)

**Configuration (remote, via feature flag `tengu_slate_heron`):**

```typescript
{
  enabled: boolean,           // default: false
  gapThresholdMinutes: number, // default: 60
  keepRecent: number,          // default: 5
}
```

**Guard conditions:**
- Must be enabled in config
- Must have explicit main-thread querySource (not undefined)
- Must find a prior assistant message
- Gap must be finite and >= threshold

### Path B: Cached Microcompaction

Uses the API's `cache_edits` feature to surgically delete tool results from the server-side
cache without modifying local message content. This preserves the cached prefix.

**Guard conditions:**
- Feature flag `CACHED_MICROCOMPACT` enabled
- Model supports cache editing
- Main thread only (not subagents)

**Behavior:**
1. Collect compactable tool IDs from assistant messages
2. Register new tool results (grouped by user message) in a persistent state object
3. Determine which tools to delete based on threshold/keep-recent config
4. Create `cache_edits` block (appended to API request, not messages)
5. Track baseline `cache_deleted_input_tokens` for delta computation after API response
6. Return messages unchanged (edits happen at the API layer)

**State management:**
- `registeredTools`: Set of tool_use_ids already tracked
- `toolOrder`: Ordered list of registered tools
- `deletedRefs`: Set of already-deleted tools
- `pinnedEdits`: Previously-sent cache_edits that must be re-sent for cache hits

### Fallback

If neither path fires, return messages unchanged. No legacy local microcompaction path
exists; autocompact handles context pressure for unsupported contexts.

---

## 6. Layer 2: Autocompaction

Automatic full-conversation compaction triggered by token count exceeding a threshold.

### Should Auto-Compact Decision

`shouldAutoCompact(messages, model, querySource?, snipTokensFreed?)` returns boolean:

**Returns false if:**
1. `DISABLE_COMPACT` or `DISABLE_AUTO_COMPACT` env vars are set
2. User disabled auto-compact in settings (`autoCompactEnabled === false`)
3. `querySource` is `'session_memory'` or `'compact'` (recursion guard)
4. `querySource` is `'marble_origami'` (context agent, would corrupt main thread state)
5. Reactive-only mode is enabled (feature flag `tengu_cobalt_raccoon`)
6. Context-collapse mode is enabled

**Returns true if:**
```
tokenCount = tokenCountWithEstimation(messages) - snipTokensFreed
tokenCount >= autoCompactThreshold
```

### Auto-Compact Execution

`autoCompactIfNeeded(messages, toolUseContext, cacheSafeParams, querySource?, tracking?, snipTokensFreed?)`:

```
1. If DISABLE_COMPACT env var is set, skip
2. Circuit breaker: if tracking.consecutiveFailures >= 3, skip
3. Call shouldAutoCompact() — if false, skip
4. Build recompactionInfo for telemetry
5. Try session memory compaction first (cheap, no API call)
   - If successful: reset state, run cleanup, return result
6. Fall back to full compactConversation()
   - If successful: reset failure counter, run cleanup, return result
7. On error: increment consecutiveFailures, return failure
```

### Tracking State

```typescript
type AutoCompactTrackingState = {
  compacted: boolean           // whether previous compaction succeeded
  turnCounter: number          // turns since last compaction
  turnId: string               // unique ID per compaction turn
  consecutiveFailures?: number // circuit breaker counter
}
```

### Token Warning State

`calculateTokenWarningState(tokenUsage, model)` returns:

```typescript
{
  percentLeft: number,                  // 0-100
  isAboveWarningThreshold: boolean,     // tokenUsage >= threshold - 20K
  isAboveErrorThreshold: boolean,       // tokenUsage >= threshold - 20K
  isAboveAutoCompactThreshold: boolean, // tokenUsage >= autoCompactThreshold
  isAtBlockingLimit: boolean,           // tokenUsage >= effectiveWindow - 3K
}
```

Where `threshold` = autoCompactThreshold if auto-compact is enabled, else effectiveContextWindow.

---

## 7. Layer 3: Full Conversation Compaction

The primary compaction mechanism: sends the entire conversation to the LLM for
summarization, then replaces all messages with the summary plus restored context.

### Entry Point

```
compactConversation(
  messages,
  context,
  cacheSafeParams,
  suppressFollowUpQuestions,
  customInstructions?,
  isAutoCompact = false,
  recompactionInfo?,
) -> CompactionResult
```

### Execution Pipeline

#### Phase 1: Pre-Compact Setup

1. Validate messages array is non-empty
2. Calculate `preCompactTokenCount` via `tokenCountWithEstimation(messages)`
3. Execute pre-compact hooks (get custom instructions, user display message)
4. Merge hook instructions with user instructions:
   - If both exist: `"${userInstructions}\n\n${hookInstructions}"`
   - If only one exists: use that one

#### Phase 2: Summarization API Call

1. Build the compact prompt via `getCompactPrompt(customInstructions)`
2. Create a user message containing the prompt
3. Enter a PTL (prompt-too-long) retry loop (see [Section 13](#13-prompt-too-long-recovery)):
   - Call `streamCompactSummary()` to get the LLM response
   - If response starts with prompt-too-long error, truncate oldest groups and retry
   - Max `MAX_PTL_RETRIES` (3) attempts
4. Validate the summary:
   - If null or empty: throw error
   - If starts with API error prefix: throw with error text

#### Phase 3: Summarization API Call Details

Two paths attempted in order:

**Path A: Cache-Sharing Fork**

Reuses the main conversation's cached prefix by running a forked agent with identical
cache-key parameters:

```
runForkedAgent({
  promptMessages: [summaryRequest],
  cacheSafeParams,
  canUseTool: denyAllTools(),
  querySource: 'compact',
  maxTurns: 1,
  skipCacheWrite: true,
})
```

Falls back to Path B on any error or empty response.

**Path B: Direct Streaming**

Direct API call with:
- System prompt: `"You are a helpful AI assistant tasked with summarizing conversations."`
- Tools: `[FileReadTool]` (+ ToolSearchTool + MCP tools if tool search is enabled)
- Thinking: disabled
- Max output tokens: `min(COMPACT_MAX_OUTPUT_TOKENS, getMaxOutputTokensForModel(model))`
- Query source: `'compact'`
- Messages are pre-processed:
  1. `getMessagesAfterCompactBoundary(messages)` - skip messages before last compact
  2. Append `summaryRequest` user message
  3. `stripReinjectedAttachments()` - remove skill_discovery/skill_listing attachments
  4. `stripImagesFromMessages()` - replace images/documents with `[image]`/`[document]` markers
  5. `normalizeMessagesForAPI()` - merge streaming chunks, ensure valid ordering

**Keep-alive:** During the API call, a 30-second interval sends session activity signals to
prevent WebSocket idle timeouts.

**Streaming retry:** If enabled (feature flag `tengu_compact_streaming_retry`), retries up to
`MAX_COMPACT_STREAMING_RETRIES` (2) times with exponential backoff.

#### Phase 4: Context Restoration

After successful summarization, generate post-compact attachments in parallel:

1. **File attachments**: Re-read the most recently accessed files (up to 5 files, 5K
   tokens each). Sorted by recency. Excludes:
   - Memory files (CLAUDE.md, etc.)
   - Files already present in preserved messages
   - Files matching `FILE_UNCHANGED_STUB` pattern

2. **Async agent attachments**: Re-attach any running background agent state

3. **Plan attachment**: If a plan exists, re-attach it

4. **Plan mode attachment**: If currently in plan mode, re-attach plan mode instructions

5. **Skill attachment**: Re-attach invoked skill content (up to 25K total, 5K per skill)

6. **Deferred tools delta**: Re-announce deferred tool schemas. Diff against empty
   message history (full compaction) or messagesToKeep (partial). Ensures the model has
   tool definitions post-compact.

7. **Agent listing delta**: Re-announce available agents

8. **MCP instructions delta**: Re-announce MCP server instructions

#### Phase 5: Post-Compact Hooks

1. Execute session start hooks (restores CLAUDE.md context, etc.)
2. Create boundary marker with:
   - Trigger: `'auto'` or `'manual'`
   - Pre-token count
   - Pre-compact discovered tool names (for schema filtering)
3. Create summary user message with formatted summary
4. Execute post-compact hooks (additional cleanup/messaging)

#### Phase 6: Token Estimation and Telemetry

1. Estimate resulting context size:
   ```
   truePostCompactTokenCount = roughTokenCountEstimationForMessages([
     boundaryMarker, ...summaryMessages, ...fileAttachments, ...hookMessages
   ])
   ```
2. Log `tengu_compact` event with comprehensive metrics
3. Reset prompt cache baseline
4. Re-append session metadata (title/tag) to stay within tail window
5. Write transcript segment for pre-compaction messages

---

## 8. Layer 4: Session Memory Compaction

An experimental, cheaper alternative to full compaction. Uses a pre-extracted session memory
(maintained by a separate background process) instead of making a summarization API call.

### Prerequisites

- Feature flags `tengu_session_memory` AND `tengu_sm_compact` both enabled
- Session memory content exists and is non-empty (not just template)
- Wait for any in-progress session memory extraction to complete

### Configuration

```typescript
{
  minTokens: 10_000,          // minimum tokens to preserve
  minTextBlockMessages: 5,     // minimum messages with text blocks to keep
  maxTokens: 40_000,          // maximum tokens to preserve (hard cap)
}
```

Loaded from remote config (`tengu_sm_compact_config`) once per session, with defaults for
any missing/zero values.

### Message Boundary Determination

1. Find `lastSummarizedMessageId` - tracks the last message covered by session memory
2. Look up that message's index in the current messages array
3. If the ID is not found (messages modified), fall back to legacy compaction

### Messages-to-Keep Calculation

`calculateMessagesToKeepIndex(messages, lastSummarizedIndex)`:

Starting from `lastSummarizedIndex + 1`, expand backwards to meet minimums:

```
startIndex = lastSummarizedIndex + 1
totalTokens = sum of estimated tokens from startIndex to end
textBlockMessageCount = count of messages with text blocks from startIndex to end

if totalTokens >= maxTokens: stop
if totalTokens >= minTokens AND textBlockMessageCount >= minTextBlockMessages: stop

// Expand backwards
floor = lastCompactBoundaryIndex + 1 (or 0 if none)
for i from startIndex-1 down to floor:
    add message tokens to totalTokens
    if hasTextBlocks: increment textBlockMessageCount
    update startIndex = i
    if totalTokens >= maxTokens: break
    if both minimums met: break
```

### API Invariant Adjustment

After calculating the start index, `adjustIndexToPreserveAPIInvariants()` ensures:

1. **Tool pairs**: If any kept message has `tool_result` blocks, include the preceding
   assistant message(s) with matching `tool_use` blocks
2. **Thinking blocks**: If any kept assistant message shares a `message.id` with a
   preceding assistant message (streaming chunks), include the preceding message

### Result Assembly

1. Filter out old compact boundary messages from messagesToKeep
2. Run session start hooks
3. Create boundary marker with preserved segment metadata
4. Create summary message from session memory content (truncated if oversized)
5. Validate: if post-compact tokens >= autoCompactThreshold, reject (return null)

### Resumed Session Handling

When `lastSummarizedMessageId` is not set but session memory has content (resumed session),
set `lastSummarizedIndex = messages.length - 1`, meaning initially no messages are kept.
The backwards expansion from `calculateMessagesToKeepIndex` then determines what to preserve.

---

## 9. Partial Compaction

Compacts a subset of the conversation around a user-selected pivot point.

### Directions

**`from` (prefix-preserving):** Summarizes messages AFTER the pivot. Earlier messages are
kept intact. Prompt cache for kept messages is preserved.

**`up_to` (suffix-preserving):** Summarizes messages BEFORE the pivot. Later messages are
kept intact. Prompt cache is invalidated since the summary precedes kept messages.

### Entry Point

```
partialCompactConversation(
  allMessages, pivotIndex, context, cacheSafeParams, userFeedback?, direction = 'from'
) -> CompactionResult
```

### Execution

1. Split messages at pivot:
   - `up_to`: summarize `messages[0..pivot)`, keep `messages[pivot..]`
   - `from`: summarize `messages[pivot..]`, keep `messages[0..pivot)`
2. For `up_to`: filter old compact boundaries and summaries from kept messages
3. Build prompt via `getPartialCompactPrompt(customInstructions, direction)`
4. Follow same PTL retry loop as full compaction
5. Generate file/tool/skill attachments (same as full compaction)
6. Annotate boundary with preserved segment:
   - `from`: anchor = boundary marker UUID
   - `up_to`: anchor = last summary message UUID

### API Messages Sent

- `up_to`: Only the summarized prefix is sent (cache hit on prefix)
- `from`: All messages are sent (tail doesn't cache)

---

## 10. Summarization Prompts

### Structure

Every summarization prompt follows this pattern:

```
[NO_TOOLS_PREAMBLE]
[COMPACT_PROMPT_BODY]
[Optional: Additional Instructions from user/hooks]
[NO_TOOLS_TRAILER]
```

### NO_TOOLS_PREAMBLE

```
CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.
- You already have all the context you need in the conversation above.
- Tool calls will be REJECTED and will waste your only turn - you will fail the task.
- Your entire response must be plain text: an <analysis> block followed by a <summary> block.
```

### NO_TOOLS_TRAILER

```
REMINDER: Do NOT call any tools. Respond with plain text only - an <analysis> block
followed by a <summary> block. Tool calls will be rejected and you will fail the task.
```

### BASE_COMPACT_PROMPT (Full Compaction)

```
Your task is to create a detailed summary of the conversation so far, paying close
attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and
architectural decisions that would be essential for continuing development work without
losing context.

[DETAILED_ANALYSIS_INSTRUCTION - see below]

Your summary should include the following sections:

1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail
2. Key Technical Concepts: List all important technical concepts, technologies, and frameworks discussed.
3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created.
   Pay special attention to the most recent messages and include full code snippets where applicable
   and include a summary of why this file read or edit is important.
4. Errors and fixes: List all errors that you ran into, and how you fixed them. Pay special attention
   to specific user feedback that you received, especially if the user told you to do something differently.
5. Problem Solving: Document problems solved and any ongoing troubleshooting efforts.
6. All user messages: List ALL user messages that are not tool results. These are critical for
   understanding the users' feedback and changing intent.
7. Pending Tasks: Outline any pending tasks that you have explicitly been asked to work on.
8. Current Work: Describe in detail precisely what was being worked on immediately before this summary
   request, paying special attention to the most recent messages from both user and assistant.
   Include file names and code snippets where applicable.
9. Optional Next Step: List the next step that you will take that is related to the most recent work
   you were doing. IMPORTANT: ensure that this step is DIRECTLY in line with the user's most recent
   explicit requests, and the task you were working on immediately before this summary request.
   If your last task was concluded, then only list next steps if they are explicitly in line with the
   users request. Do not start on tangential requests or really old requests that were already completed
   without confirming with the user first.
   If there is a next step, include direct quotes from the most recent conversation showing exactly what
   task you were working on and where you left off. This should be verbatim to ensure there's no drift
   in task interpretation.
```

### DETAILED_ANALYSIS_INSTRUCTION

```
Before providing your final summary, wrap your analysis in <analysis> tags to organize
your thoughts and ensure you've covered all necessary points. In your analysis process:

1. Chronologically analyze each message and section of the conversation. For each section thoroughly identify:
   - The user's explicit requests and intents
   - Your approach to addressing the user's requests
   - Key decisions, technical concepts and code patterns
   - Specific details like:
     - file names
     - full code snippets
     - function signatures
     - file edits
   - Errors that you ran into and how you fixed them
   - Pay special attention to specific user feedback that you received, especially if the
     user told you to do something differently.
2. Double-check for technical accuracy and completeness, addressing each required element thoroughly.
```

### PARTIAL_COMPACT_PROMPT (direction: 'from')

Same structure but scoped to "recent messages" after retained context. Uses
`DETAILED_ANALYSIS_INSTRUCTION_PARTIAL` which says "Analyze the recent messages
chronologically" instead of "each message and section of the conversation".

### PARTIAL_COMPACT_UP_TO_PROMPT (direction: 'up_to')

Summary placed at the start of a continuing session. Section 8 becomes "Work Completed"
and section 9 becomes "Context for Continuing Work" (instead of "Current Work" / "Optional
Next Step").

### Custom Instructions

Appended after the main prompt body:
```
Additional Instructions:
{customInstructions}
```

### Expected Output Format

```xml
<analysis>
[Drafting scratchpad - chronological analysis ensuring coverage]
</analysis>

<summary>
1. Primary Request and Intent: ...
2. Key Technical Concepts: ...
3. Files and Code Sections: ...
4. Errors and fixes: ...
5. Problem Solving: ...
6. All user messages: ...
7. Pending Tasks: ...
8. Current Work: ...
9. Optional Next Step: ...
</summary>
```

### Summary Post-Processing

`formatCompactSummary(summary)`:

1. Strip `<analysis>...</analysis>` block entirely (drafting scratchpad, not needed)
2. Extract `<summary>...</summary>` content, replace with `Summary:\n{content}`
3. Collapse multiple blank lines to double newline
4. Trim

### User Summary Message Template

```
This session is being continued from a previous conversation that ran out of context.
The summary below covers the earlier portion of the conversation.

{formattedSummary}

[If transcript path exists:]
If you need specific details from before compaction (like exact code snippets, error
messages, or content you generated), read the full transcript at: {transcriptPath}

[If recent messages preserved:]
Recent messages are preserved verbatim.

[If suppressFollowUpQuestions:]
Continue the conversation from where it left off without asking the user any further
questions. Resume directly - do not acknowledge the summary, do not recap what was
happening, do not preface with "I'll continue" or similar. Pick up the last task as if
the break never happened.

[If proactive/autonomous mode is active:]
You are running in autonomous/proactive mode. This is NOT a first wake-up - you were
already working autonomously before compaction. Continue your work loop: pick up where
you left off based on the summary above. Do not greet the user or ask what to work on.
```

---

## 11. Post-Compaction Message Assembly

The resulting message array after compaction follows this exact order:

```
1. boundaryMarker        (SystemCompactBoundaryMessage)
2. summaryMessages[]     (UserMessage with isCompactSummary flag)
3. messagesToKeep[]      (optional, preserved verbatim messages)
4. attachments[]         (file restorations, tool re-announcements, skills, plans)
5. hookResults[]         (session start hook outputs, e.g., CLAUDE.md)
```

Built by `buildPostCompactMessages(result)`:

```typescript
function buildPostCompactMessages(result: CompactionResult): Message[] {
  return [
    result.boundaryMarker,
    ...result.summaryMessages,
    ...(result.messagesToKeep ?? []),
    ...result.attachments,
    ...result.hookResults,
  ]
}
```

### Attachment Types Generated Post-Compact

1. **File read restorations**: Most recently read files (by timestamp), re-read via
   FileReadTool for fresh content. Max 5 files, 5K tokens each. Excludes files already
   visible in preserved messages.

2. **Async agent attachments**: State of running background agents.

3. **Plan attachment**: Current plan content (if exists).

4. **Plan mode attachment**: Plan mode instructions (if active).

5. **Skill attachment**: Content of invoked skills during the session. Up to 25K total
   token budget, 5K per skill.

6. **Deferred tools delta**: Re-announces tool schemas that were lazily loaded. Computes
   diff against preserved messages (or empty for full compact) to avoid redundancy.

7. **Agent listing delta**: Re-announces available agent definitions.

8. **MCP instructions delta**: Re-announces MCP server instructions and tool descriptions.

### Preserved Segment Metadata

When `messagesToKeep` exists, the boundary marker is annotated with a `preservedSegment`:

```typescript
{
  headUuid: messagesToKeep[0].uuid,        // first preserved message
  anchorUuid: <varies by direction>,        // splice point
  tailUuid: messagesToKeep.last().uuid,     // last preserved message
}
```

This enables session loaders to properly reconstruct the message chain when resuming from
disk. The anchor UUID determines where the preserved segment is spliced:
- **Suffix-preserving** (reactive/session-memory): last summary message UUID
- **Prefix-preserving** (partial compact): boundary marker UUID

---

## 12. Post-Compaction Cleanup

`runPostCompactCleanup(querySource?)` invalidates caches and tracking state:

**Always cleared (all threads):**
1. `resetMicrocompactState()` - clear cached MC tool tracking
2. `clearSystemPromptSections()` - clear dynamic system prompt injections
3. `clearClassifierApprovals()` - clear tool permission approvals
4. `clearSpeculativeChecks()` - clear bash permission pre-checks
5. `clearBetaTracingState()` - clear experimentation tracking
6. `sweepFileContentCache()` - clear attribution file caches
7. `clearSessionMessagesCache()` - clear session message cache

**Main thread only (not subagents):**
8. `resetContextCollapse()` - flush collapse commit log
9. `getUserContext.cache.clear()` - clear memoized user context
10. `resetGetMemoryFilesCache()` - clear memory file cache

**Intentionally NOT cleared:**
- Invoked skill content (needed for post-compact skill attachments)
- Sent skill names (re-injecting full skill_listing is pure cache_creation waste)

**Subagent safety:** Subagents run in the same process and share module-level state. Only
main-thread compactions reset module-level state to prevent corrupting the main thread.
Detection: `querySource.startsWith('repl_main_thread')` or `querySource === 'sdk'` or
`querySource === undefined`.

---

## 13. Prompt-Too-Long Recovery

When the compaction API call itself exceeds the context window, a retry loop truncates the
oldest message groups.

### Algorithm

`truncateHeadForPTLRetry(messages, ptlResponse)`:

1. Strip any synthetic retry marker from a previous attempt (prevents stalling)
2. Group messages by API round (see [Section 14](#14-message-grouping))
3. If fewer than 2 groups, return null (cannot truncate)
4. Determine `dropCount`:
   - If token gap is parseable from error: drop groups until accumulated tokens >= gap
   - If unparseable: drop 20% of groups (minimum 1)
   - Never drop all groups (keep at least 1)
5. Slice off the first `dropCount` groups
6. If the result starts with an assistant message, prepend a synthetic user marker:
   `"[earlier conversation truncated for compaction retry]"` (isMeta: true)

### Retry Loop (in compactConversation)

```
for (;;):
    response = await streamCompactSummary(messagesToSummarize, ...)
    summary = getAssistantMessageText(response)
    if summary does not start with PROMPT_TOO_LONG_ERROR_MESSAGE: break

    ptlAttempts++
    if ptlAttempts > MAX_PTL_RETRIES (3): throw ERROR_MESSAGE_PROMPT_TOO_LONG
    truncated = truncateHeadForPTLRetry(messagesToSummarize, response)
    if truncated is null: throw ERROR_MESSAGE_PROMPT_TOO_LONG

    messagesToSummarize = truncated
    update cacheSafeParams.forkContextMessages = truncated
```

---

## 14. Message Grouping

`groupMessagesByApiRound(messages)` splits messages at API-round boundaries.

### Algorithm

A boundary fires when a NEW assistant response begins (different `message.id` from the
prior assistant). Streaming chunks from the same API response share an `id`, so boundaries
only fire at genuinely new rounds.

```
groups = []
current = []
lastAssistantId = undefined

for msg in messages:
    if msg.type === 'assistant'
       AND msg.message.id !== lastAssistantId
       AND current.length > 0:
        groups.push(current)
        current = [msg]
    else:
        current.push(msg)

    if msg.type === 'assistant':
        lastAssistantId = msg.message.id

if current.length > 0:
    groups.push(current)

return groups
```

**Why API-round grouping instead of human-turn grouping:** Allows reactive compact to
operate on single-prompt agentic sessions (SDK/eval callers) where the entire workload is
one human turn. Finer-grained grouping enables more precise truncation.

**API safety:** The API contract guarantees every `tool_use` is resolved before the next
assistant turn, so `lastAssistantId` alone is a sufficient boundary gate. Dangling
`tool_use` from resume/truncation is handled by `ensureToolResultPairing` at API time.

---

## 15. API Invariant Preservation

When slicing messages (for partial compact or session memory compact), the system ensures
valid API message sequences.

### Tool Use / Tool Result Pairing

Every `tool_result` block references a `tool_use_id`. The corresponding `tool_use` block
(in a preceding assistant message) must be included in the kept messages.

**Algorithm:**
1. Collect all `tool_result` IDs from kept messages
2. Collect all `tool_use` IDs already in kept range
3. Find needed IDs = `tool_result` IDs not in kept `tool_use` IDs
4. Scan backwards from start index to find assistant messages with matching `tool_use` blocks
5. Expand start index to include those messages

### Thinking Block Continuity

Streaming yields separate messages per content block (thinking, tool_use, etc.) with the
same `message.id` but different UUIDs. If the start index lands mid-stream:

1. Collect all `message.id` values from assistant messages in kept range
2. Scan backwards for assistant messages with matching `message.id`
3. Expand start index to include them (so `normalizeMessagesForAPI` can merge properly)

### Image/Document Stripping

Before sending to the summarization API, images and documents are replaced:

```
image blocks -> { type: "text", text: "[image]" }
document blocks -> { type: "text", text: "[document]" }
```

This applies to:
- Direct image/document blocks in user messages
- Image/document blocks nested inside `tool_result` content arrays

### Attachment Stripping

Before summarization, `skill_discovery` and `skill_listing` attachment messages are removed.
These are re-injected post-compaction by the tool/skill announcement system.

---

## 16. Hooks Integration

### Pre-Compact Hooks

Executed before summarization. Can provide:
- `newCustomInstructions`: Additional instructions for the summarizer
- `userDisplayMessage`: Text shown to the user

Input:
```typescript
{
  trigger: "manual" | "auto",
  customInstructions: string | null,
}
```

### Post-Compact Hooks

Executed after summarization. Can provide:
- `userDisplayMessage`: Additional text shown to the user

Input:
```typescript
{
  trigger: "manual" | "auto",
  compactSummary: string,
}
```

### Session Start Hooks

Executed after compaction (same as on session start). Restores:
- CLAUDE.md content
- Other session initialization context

Input:
```typescript
{
  model: string,
}
```

Returns: `HookResultMessage[]` (included in post-compact message assembly)

---

## 17. Telemetry Events

### `tengu_compact`
Full compaction completion. Fields:
- `preCompactTokenCount`, `postCompactTokenCount`, `truePostCompactTokenCount`
- `autoCompactThreshold`, `willRetriggerNextTurn`
- `isAutoCompact`, `querySource`
- `isRecompactionInChain`, `turnsSincePreviousCompact`, `previousCompactTurnId`
- `compactionInputTokens`, `compactionOutputTokens`
- `compactionCacheReadTokens`, `compactionCacheCreationTokens`, `compactionTotalTokens`
- `promptCacheSharingEnabled`
- Context analysis breakdown (token stats by category)

### `tengu_compact_ptl_retry`
Prompt-too-long retry attempt. Fields: `attempt`, `droppedMessages`, `remainingMessages`

### `tengu_compact_failed`
Compaction failure. Fields: `reason` (prompt_too_long, no_summary, api_error,
no_streaming_response), `preCompactTokenCount`, `promptCacheSharingEnabled`

### `tengu_compact_cache_sharing_success`
Cache-sharing fork succeeded. Fields: `preCompactTokenCount`, `outputTokens`,
`cacheReadInputTokens`, `cacheCreationInputTokens`, `cacheHitRate`

### `tengu_compact_cache_sharing_fallback`
Cache-sharing fork failed. Fields: `reason` (no_text_response, error),
`preCompactTokenCount`

### `tengu_compact_streaming_retry`
Streaming retry attempt. Fields: `attempt`, `preCompactTokenCount`, `hasStartedStreaming`

### `tengu_partial_compact`
Partial compaction completion. Fields: `preCompactTokenCount`, `postCompactTokenCount`,
`messagesKept`, `messagesSummarized`, `direction`, `hasUserFeedback`

### `tengu_cached_microcompact`
Cache-editing microcompact. Fields: `toolsDeleted`, `deletedToolIds`, `activeToolCount`,
`triggerType`, `threshold`, `keepRecent`

### `tengu_time_based_microcompact`
Time-based microcompact. Fields: `gapMinutes`, `gapThresholdMinutes`, `toolsCleared`,
`toolsKept`, `keepRecent`, `tokensSaved`

### `tengu_sm_compact_*`
Session memory compaction events:
- `tengu_sm_compact_flag_check`: Feature flag evaluation
- `tengu_sm_compact_no_session_memory`: No session memory file
- `tengu_sm_compact_empty_template`: Session memory is template-only
- `tengu_sm_compact_summarized_id_not_found`: Boundary message not in current messages
- `tengu_sm_compact_resumed_session`: Resumed session without boundary
- `tengu_sm_compact_threshold_exceeded`: Post-compact tokens still over threshold
- `tengu_sm_compact_error`: Error during SM compaction

### `tengu_post_autocompact_turn`
Tracks turns after autocompaction for quality analysis.

---

## 18. Environment Variable Overrides

| Variable | Effect |
|----------|--------|
| `DISABLE_COMPACT` | Disables all compaction (auto and manual) |
| `DISABLE_AUTO_COMPACT` | Disables auto-compact only (manual /compact still works) |
| `CLAUDE_CODE_MAX_CONTEXT_TOKENS` | Override context window size |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | Override context window for auto-compact threshold |
| `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` | Set auto-compact threshold as percentage of effective window |
| `CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE` | Override blocking limit token count |
| `CLAUDE_CODE_DISABLE_1M_CONTEXT` | Disable 1M context window |
| `ENABLE_CLAUDE_CODE_SM_COMPACT` | Force-enable session memory compaction |
| `DISABLE_CLAUDE_CODE_SM_COMPACT` | Force-disable session memory compaction |

---

## 19. Feature Flags

| Flag | Purpose |
|------|---------|
| `CACHED_MICROCOMPACT` | Enable cache-editing microcompaction |
| `CONTEXT_COLLAPSE` | Enable granular context compression system |
| `REACTIVE_COMPACT` | Handle prompt-too-long at runtime |
| `PROMPT_CACHE_BREAK_DETECTION` | Detect prompt cache invalidation |
| `KAIROS` | Session transcript writing |
| `HISTORY_SNIP` | Historical message truncation |
| `EXPERIMENTAL_SKILL_SEARCH` | Skill discovery system |
| `PROACTIVE` | Autonomous/proactive mode |
| `tengu_compact_cache_prefix` | Prompt cache sharing during compact (default: true) |
| `tengu_compact_streaming_retry` | Retry streaming fallback (default: false) |
| `tengu_cobalt_raccoon` | Reactive-only mode (suppresses proactive autocompact) |
| `tengu_session_memory` | Session memory extraction enabled |
| `tengu_sm_compact` | Session memory compaction enabled |
| `tengu_sm_compact_config` | Remote config for SM compact thresholds |
| `tengu_slate_heron` | Time-based microcompact config |
| `tengu_cached_microcompact` | Cached MC enabled |

---

## 20. Error Handling

### Error Messages

| Constant | Value | When |
|----------|-------|------|
| `ERROR_MESSAGE_NOT_ENOUGH_MESSAGES` | "Not enough messages to compact." | Empty message array |
| `ERROR_MESSAGE_PROMPT_TOO_LONG` | "Conversation too long. Press esc twice to go up a few messages and try again." | PTL retries exhausted |
| `ERROR_MESSAGE_USER_ABORT` | "API Error: Request was aborted." | User pressed Esc |
| `ERROR_MESSAGE_INCOMPLETE_RESPONSE` | "Compaction interrupted - This may be due to network issues - please try again." | Streaming failed after retries |

### Error Behavior

- **Auto-compact errors**: Logged, failure counter incremented, retried next turn.
  No user notification (confusing when it eventually succeeds).
- **Manual compact errors**: User notification shown (except for abort and
  not-enough-messages). Error re-thrown to caller.
- **Circuit breaker**: After 3 consecutive autocompact failures, stop retrying for the
  rest of the session.
- **Session memory compact errors**: Silently fall back to legacy compaction. Errors are
  expected (file not found, path issues).

### User Abort Handling

`APIUserAbortError` is caught and converted to `ERROR_MESSAGE_USER_ABORT`. The abort
signal is `context.abortController.signal`, shared between the cache-sharing fork and
streaming fallback paths.

---

## Implementation Checklist

For a developer implementing this system in another codebase:

1. **Token counting**: Implement the 3-tier estimation system. The rough estimator
   (bytes/4) is sufficient for thresholds; API usage is authoritative.

2. **Microcompaction**: Implement time-based clearing first (simplest). Cache-editing
   requires API support for `cache_edits`.

3. **Autocompaction**: Implement threshold detection, circuit breaker, and the
   summarization API call. Start with the direct streaming path.

4. **Summarization prompt**: Use the exact prompt text from Section 10. The `<analysis>`
   scratchpad significantly improves summary quality.

5. **Post-compact assembly**: Follow the exact message ordering. Re-announce tools,
   restore recent files, preserve API invariants.

6. **PTL recovery**: Implement the group-based truncation retry loop.

7. **Session memory compact**: Implement last if needed. Requires a separate session memory
   extraction system.

8. **Partial compact**: Implement last. Requires UI for message selection.

Key invariants to maintain:
- Every `tool_result` must have a matching `tool_use` in the same or earlier message
- First API message must be role=user
- Messages with same `message.id` must be adjacent (streaming chunk merging)
- Boundary markers must be present for session resume/loader to reconstruct the chain