# `/context` Command — Full Implementation Spec

> Specification for reimplementing the Claude Code `/context` command in a different repository/stack.
> Derived from source inspection of the Claude Code CLI (TypeScript/React Ink).

---

## Table of Contents

1. [Overview](#1-overview)
2. [Command Registration](#2-command-registration)
3. [Data Pipeline](#3-data-pipeline)
4. [Context Window Resolution](#4-context-window-resolution)
5. [Token Counting](#5-token-counting)
6. [Context Analysis — Data Collection](#6-context-analysis--data-collection)
7. [Data Model / Types](#7-data-model--types)
8. [Category Definitions & Ordering](#8-category-definitions--ordering)
9. [Grid Visualization](#9-grid-visualization)
10. [Interactive UI Layout](#10-interactive-ui-layout)
11. [Non-Interactive Output (Markdown)](#11-non-interactive-output-markdown)
12. [Context Suggestions](#12-context-suggestions)
13. [Token Warnings](#13-token-warnings)
14. [Status Line Integration](#14-status-line-integration)
15. [Context Collapse / Compaction Integration](#15-context-collapse--compaction-integration)
16. [Constants Reference](#16-constants-reference)
17. [Integration Points](#17-integration-points)
18. [Implementation Checklist](#18-implementation-checklist)

---

## 1. Overview

The `/context` command provides a visual breakdown of how the model's context window is being used. It shows:

- Total token usage vs. context window capacity (as a percentage)
- Per-category breakdown (system prompt, tools, memory, messages, etc.)
- A colored grid visualization of token distribution
- Actionable suggestions for reducing context usage
- Detailed sub-breakdowns (per-tool, per-memory-file, per-message-type)

There are **two rendering paths**:

| Mode | Type | Output |
|------|------|--------|
| **Interactive** | `local-jsx` (React component) | Colored grid + detailed breakdown in terminal |
| **Non-interactive** | `local` (plain function) | Markdown table (for SDK/CI/scripting) |

Only one is enabled at a time, determined by session type.

---

## 2. Command Registration

Two command objects are registered under the same name `context`:

### Interactive variant

```
name:        "context"
description: "Visualize current context usage as a colored grid"
type:        "local-jsx"   (renders a React component)
isEnabled:   () => !isNonInteractiveSession()
load:        () => import('./context.js')
```

### Non-interactive variant

```
name:                  "context"
description:           "Show current context usage"
type:                  "local"
supportsNonInteractive: true
isHidden:              isNonInteractiveSession() ? false : true
isEnabled:             () => isNonInteractiveSession()
load:                  () => import('./context-noninteractive.js')
```

The command has no aliases, no arguments, and no keybindings. It is invoked as `/context`.

---

## 3. Data Pipeline

Both paths follow the same data-transformation pipeline before analysis:

```
Raw conversation messages
       │
       ▼
┌──────────────────────────────┐
│ 1. Compact Boundary Filter   │  Remove messages before last compaction point
│    getMessagesAfterCompact() │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 2. Context Collapse          │  If feature-flagged: apply projectView()
│    (optional)                │  to match what the API actually sees
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 3. Microcompact              │  Compress tool results (truncation, dedup)
│    microcompactMessages()    │  to match actual API payload
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 4. analyzeContextUsage()     │  Core analysis: produces ContextData
└──────────────┬───────────────┘
               │
       ┌───────┴───────┐
       ▼               ▼
  Interactive      Non-interactive
  (React grid)     (Markdown table)
```

**Key design principle**: The `/context` command shows what the model *actually sees*, not the raw REPL history. Without the transforms, token counts would overcount.

---

## 4. Context Window Resolution

Function: `getContextWindowForModel(model, betas?) → number`

Resolution priority (first match wins):

| Priority | Condition | Result |
|----------|-----------|--------|
| 1 | Env override `CLAUDE_CODE_MAX_CONTEXT_TOKENS` (internal only) | Parsed integer |
| 2 | Model string has `[1m]` suffix (e.g. `claude-opus-4-6[1m]`) | 1,000,000 |
| 3 | Model capability registry has `max_input_tokens >= 100,000` | `cap.max_input_tokens` |
| 4 | Beta header `CONTEXT_1M_BETA_HEADER` present AND model supports 1M | 1,000,000 |
| 5 | Sonnet 1M experiment treatment (growthbook flag) | 1,000,000 |
| 6 | Internal model alias has custom context window | Alias value |
| 7 | Default fallback | **200,000** |

### 1M Context Support

- `modelSupports1M(model)` → `true` for `claude-sonnet-4` or `opus-4-6` (unless disabled)
- `has1mContext(model)` → checks for `[1m]` suffix in model string
- `is1mContextDisabled()` → reads `CLAUDE_CODE_DISABLE_1M_CONTEXT` env var (HIPAA compliance)

### Max Output Tokens per Model

| Model Family | Default | Upper Limit |
|-------------|---------|-------------|
| Opus 4.6 | 64,000 | 128,000 |
| Sonnet 4.6 | 32,000 | 128,000 |
| Opus 4.5, Sonnet 4, Haiku 4 | 32,000 | 64,000 |
| Opus 4.1/4 | 32,000 | 32,000 |
| Claude 3 Opus | 4,096 | 4,096 |
| 3.5 Sonnet/Haiku | 8,192 | 8,192 |
| 3.7 Sonnet | 32,000 | 64,000 |

---

## 5. Token Counting

### 5.1 Counting Strategy (3-tier fallback)

| Tier | Method | When Used |
|------|--------|-----------|
| **Primary** | Anthropic token counting API | API available and responsive |
| **Fallback 1** | Haiku model as fast counter | API counting endpoint fails |
| **Fallback 2** | Rough local estimation | All API calls fail |

### 5.2 Rough Estimation Formula

```
tokens ≈ content.length / 4
```

(Approximately 4 characters per token.)

### 5.3 Tool Token Overhead

Each API call with tools includes a ~500-token preamble. When counting tools individually, subtract this overhead per tool to avoid N×overhead instead of 1×overhead:

```
perToolTokens = max(0, apiCountResult - 500)
```

### 5.4 API Usage Extraction

Preferred source of total tokens when available:

```
totalInputTokens = usage.input_tokens
                 + usage.cache_creation_input_tokens
                 + usage.cache_read_input_tokens
```

This is extracted from the last API response in the message history.

### 5.5 Context Percentage Calculation

```
function calculateContextPercentages(currentUsage, contextWindowSize):
    totalInput = input_tokens + cache_creation_input_tokens + cache_read_input_tokens
    usedPct    = clamp(round((totalInput / contextWindowSize) * 100), 0, 100)
    remaining  = 100 - usedPct
    return { used: usedPct, remaining }
```

---

## 6. Context Analysis — Data Collection

Function: `analyzeContextUsage()` — the core engine.

### 6.1 Inputs

| Parameter | Description |
|-----------|-------------|
| `messages` | Post-microcompact messages |
| `model` | Model identifier string |
| `getToolPermissionContext` | Async function returning tool permissions |
| `tools` | All registered tools |
| `agentDefinitions` | Agent configuration registry |
| `terminalWidth?` | Terminal columns (for responsive grid sizing) |
| `toolUseContext?` | Full tool context (for system prompt calculation) |
| `mainThreadAgentDefinition?` | Agent definition for main thread |
| `originalMessages?` | Pre-transform messages (for API usage extraction) |

### 6.2 Seven Parallel Counting Operations

All run concurrently via `Promise.all`:

| # | Function | What It Counts |
|---|----------|---------------|
| 1 | `countSystemTokens(effectiveSystemPrompt)` | System prompt sections (markdown headings), git status, date context |
| 2 | `countMemoryFileTokens()` | CLAUDE.md files — per-file token breakdown |
| 3 | `countBuiltInToolTokens(...)` | Built-in tools (Bash, Read, Write, etc.) — always-loaded vs. deferred |
| 4 | `countMcpToolTokens(...)` | MCP tools — single bulk API call, per-tool estimation via name+description+schema |
| 5 | `countCustomAgentTokens(...)` | Custom agents (excludes built-in) — agentType + whenToUse text |
| 6 | `countSlashCommandTokens(...)` | Skill tool schema overhead |
| 7 | `approximateMessageTokens(messages)` | Per-message-type breakdown (see below) |

**Skill counting** runs separately (error-isolated) after the parallel batch:

| 8 | `countSkillTokens(...)` | Skill frontmatter only (name, description, whenToUse) |

### 6.3 System Prompt Counting

- Extracts section names from markdown `#` headings
- Counts tokens per section
- Includes injected context: git status, current date, cache breaker

### 6.4 Built-in Tool Counting

- Separates **always-loaded** tools from **deferred** tools (tool search enabled)
- Tracks which deferred tools are actually used in message history
- Per-tool breakdown uses proportional schema-size estimation
- Subtracts 500-token overhead per tool

### 6.5 MCP Tool Counting

- **Single bulk API call** for all MCP tools (not N individual calls)
- Per-tool estimation: `roughTokenCount(name + description + JSON.stringify(inputSchema))`
- Separates deferred (tool-search-loaded) from always-loaded
- Returns: `{ mcpToolTokens, mcpToolDetails[], deferredToolTokens }`

### 6.6 Message Breakdown

`approximateMessageTokens(messages)` returns:

| Field | Description |
|-------|-------------|
| `totalTokens` | Sum of all message tokens |
| `toolCallTokens` | Tokens in assistant `tool_use` blocks |
| `toolResultTokens` | Tokens in user `tool_result` blocks |
| `attachmentTokens` | Tokens in attachment messages |
| `assistantMessageTokens` | Text blocks in assistant messages |
| `userMessageTokens` | Text blocks in user messages |
| `toolCallsByType` | Map: tool name → call token count |
| `toolResultsByType` | Map: tool name → result token count |
| `attachmentsByType` | Map: attachment type → token count |

Tool result attribution works by mapping `tool_use_id` from assistant messages to tool names, then matching results by the same ID.

### 6.7 Final Token Total

Two sources, priority order:

1. **API usage** (from last API response): `input_tokens + cache_creation + cache_read`
2. **Estimated sum** of all categories (fallback)

API usage is preferred for consistency with the status line display.

---

## 7. Data Model / Types

### ContextData (main output)

```typescript
interface ContextData {
  categories: ContextCategory[]       // Ordered list of token categories
  totalTokens: number                 // Final token count (API or estimated)
  maxTokens: number                   // Context window size
  rawMaxTokens: number                // Same as maxTokens (raw context window)
  percentage: number                  // Usage % (0-100)
  gridRows: GridSquare[][]            // 2D grid for visualization
  model: string                       // Runtime model name
  memoryFiles: MemoryFile[]           // Per-file token breakdown
  mcpTools: McpTool[]                 // Per-MCP-tool token breakdown
  deferredBuiltinTools?: DeferredBuiltinTool[]  // (internal only)
  systemTools?: SystemToolDetail[]              // (internal only)
  systemPromptSections?: SystemPromptSectionDetail[]  // (internal only)
  agents: Agent[]                     // Custom agents with tokens
  slashCommands?: SlashCommandInfo    // Command count + tokens
  skills?: SkillInfo                  // Skill count + per-skill tokens
  autoCompactThreshold?: number       // Token threshold for autocompact
  isAutoCompactEnabled: boolean
  messageBreakdown?: MessageBreakdown // Detailed message category breakdown
  apiUsage: ApiUsage | null           // Actual API usage (if available)
}
```

### ContextCategory

```typescript
interface ContextCategory {
  name: string            // Display name
  tokens: number          // Token count for this category
  color: string           // Theme color key
  isDeferred?: boolean    // If true, not counted toward usage percentage
}
```

### GridSquare

```typescript
interface GridSquare {
  color: string           // Theme color key
  isFilled: boolean       // Always true
  categoryName: string    // Which category this square belongs to
  tokens: number          // Total tokens of the category
  percentage: number      // Category's % of context window
  squareFullness: number  // 0.0 - 1.0 (for partial square rendering)
}
```

### ContextSuggestion

```typescript
type ContextSuggestion = {
  severity: 'info' | 'warning'
  title: string
  detail: string
  savingsTokens?: number   // Estimated tokens that could be saved
}
```

### MessageBreakdown

```typescript
interface MessageBreakdown {
  toolCallTokens: number
  toolResultTokens: number
  attachmentTokens: number
  assistantMessageTokens: number
  userMessageTokens: number
  toolCallsByType: Array<{ name: string; callTokens: number; resultTokens: number }>
  attachmentsByType: Array<{ name: string; tokens: number }>
}
```

### ApiUsage

```typescript
interface ApiUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}
```

### MemoryFile

```typescript
interface MemoryFile {
  type: string     // e.g. "project", "user"
  path: string     // File path
  tokens: number   // Token count
}
```

### McpTool

```typescript
interface McpTool {
  name: string
  serverName: string
  tokens: number
}
```

### Agent

```typescript
interface Agent {
  agentType: string
  source: 'projectSettings' | 'userSettings' | 'localSettings' | 'flagSettings'
         | 'policySettings' | 'plugin' | 'built-in'
  tokens: number
}
```

### SkillInfo

```typescript
interface SkillInfo {
  totalSkills: number
  includedSkills: number
  tokens: number
  skillFrontmatter: Array<{
    name: string
    source: string
    tokens: number
  }>
}
```

---

## 8. Category Definitions & Ordering

Categories are built in this fixed order:

| # | Name | Color | Condition |
|---|------|-------|-----------|
| 1 | **System prompt** | `promptBorder` | Always (if > 0 tokens) |
| 2 | **System tools** | `inactive` | Always (if > 0) |
| 3 | **MCP tools** | `cyan` | If MCP tools loaded |
| 4 | **MCP tools (deferred)** | `inactive` | Tool search enabled; `isDeferred: true` |
| 5 | **System tools (deferred)** | `inactive` | Tool search enabled; `isDeferred: true` |
| 6 | **Custom agents** | `permission` | If custom agents defined |
| 7 | **Memory files** | `claude` (brand color) | If CLAUDE.md files exist |
| 8 | **Skills** | `warning` | If skills loaded |
| 9 | **Messages** | `purple` | If conversation has messages |
| 10 | **Autocompact buffer** / **Manual compact buffer** | `inactive` | See rules below |
| 11 | **Free space** | `promptBorder` (dimmed) | Always (remaining capacity) |

### Reserved Buffer Rules

| Condition | Buffer Category | Size |
|-----------|----------------|------|
| Autocompact enabled (normal mode) | "Autocompact buffer" | `contextWindow - autoCompactThreshold` (~13k-33k tokens) |
| Autocompact disabled | "Manual compact buffer" | 3,000 tokens |
| Reactive-only compaction mode | *(none — skipped)* | 0 |
| Context collapse enabled | *(none — skipped)* | 0 |

### Deferred Categories

Categories with `isDeferred: true` are:
- **Excluded** from usage percentage calculation
- **Excluded** from grid visualization
- **Shown** in the detail breakdown for visibility
- Used for tools loaded on-demand via tool search

### Free Space Calculation

```
actualUsage = sum of all non-deferred category tokens
freeTokens  = max(0, contextWindow - actualUsage - reservedTokens)
```

---

## 9. Grid Visualization

### 9.1 Grid Dimensions

| Context Window | Screen Width | Grid Size |
|---------------|-------------|-----------|
| < 1,000,000 | < 80 cols | 5 × 5 (25 squares) |
| < 1,000,000 | ≥ 80 cols | 10 × 10 (100 squares) |
| ≥ 1,000,000 | < 80 cols | 5 × 10 (50 squares) |
| ≥ 1,000,000 | ≥ 80 cols | 20 × 10 (200 squares) |

### 9.2 Square Allocation

Each category gets squares proportional to its token share:

```
exactSquares = (category.tokens / contextWindow) * TOTAL_SQUARES
allocatedSquares = max(1, round(exactSquares))   // min 1 for non-free categories
                   round(exactSquares)            // for Free space (can be 0)
```

### 9.3 Partial Square Fullness

The last square of a category may be partially filled:

```
wholeSquares = floor(exactSquares)
fractionalPart = exactSquares - wholeSquares

For square[i]:
  if i < wholeSquares:  squareFullness = 1.0
  if i == wholeSquares: squareFullness = fractionalPart
```

### 9.4 Square Rendering Order

1. All non-reserved, non-free-space categories (in category order)
2. Free space squares (filling up to `TOTAL_SQUARES - reservedSquareCount`)
3. Reserved buffer squares (at the end)

### 9.5 Visual Symbols

| Symbol | Unicode | Meaning |
|--------|---------|---------|
| ◉ | U+26C1 | Full square (category at ≥70% fullness) |
| ◐ | U+26C0 | Partial square (category at <70% fullness) |
| ◻ | U+26F6 | Free space (dimmed) |
| ⚡ | U+26DD | Autocompact buffer (reserved) |

Grid is rendered row by row, with each square colored according to its category's theme color.

---

## 10. Interactive UI Layout

The interactive `/context` command renders a **two-column layout**:

```
┌────────────────────────────────┬──────────────────────────────────────┐
│                                │                                      │
│   Context Usage                │  Model: claude-opus-4-6[1m]          │
│                                │  Tokens: 45.2k / 1M (5%)            │
│   ◉◉◉◉◉◉◉◉◉◉◉◉◉◉◉◉◉◉◉◉     │                                      │
│   ◉◉◐◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻     │  ◉ System prompt     3.2k   0.3%    │
│   ◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻     │  ◉ System tools      8.1k   0.8%    │
│   ◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻     │  ◉ MCP tools         2.5k   0.3%    │
│   ◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻     │  ◉ Memory files      1.2k   0.1%    │
│   ◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻     │  ◉ Messages         28.5k   2.9%    │
│   ◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻     │  ◻ Free space      955.2k  95.5%    │
│   ◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻     │                                      │
│   ◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻     │  MCP Tools:                          │
│   ◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻◻     │    serena / find_symbol     320      │
│                                │    serena / list_dir        280      │
│                                │                                      │
│                                │  Memory Files:                       │
│                                │    project  .claude/CLAUDE.md  800   │
│                                │    user     ~/.claude/CLAUDE.md 400  │
│                                │                                      │
│                                │  Suggestions:                        │
│                                │  ⚠ Near capacity → save ~12k        │
│                                │    Use /compact to free space        │
│                                │                                      │
└────────────────────────────────┴──────────────────────────────────────┘
```

### Left Column: Grid

- Header: "Context Usage" (bold)
- Grid rows rendered with colored squares
- Each row = `GRID_WIDTH` squares

### Right Column: Summary & Details

Rendered top-to-bottom:

1. **Header info**: Model name, token count, percentage
2. **Context strategy** (if context collapse enabled): collapse status, span counts, errors
3. **Category legend**: Each category with symbol, name, tokens, percentage
4. **MCP Tools detail**: Per-tool name, server, tokens (table)
5. **System tools detail**: Per-tool name, tokens (internal only)
6. **System prompt sections**: Per-section name, tokens (internal only)
7. **Custom agents detail**: Per-agent type, source, tokens
8. **Memory files detail**: Per-file type, path, tokens
9. **Skills detail**: Per-skill name, source, tokens
10. **Message breakdown**: Tool calls, tool results, attachments, assistant/user messages (internal only)
11. **Top tools**: By combined call+result tokens
12. **Top attachments**: By tokens
13. **Deferred built-in tools**: (if any)
14. **Context suggestions**: Generated recommendations

### Rendering

The component is rendered to ANSI string via `renderToAnsiString()` (React → ANSI), then passed to the command completion callback. This is a **one-shot render** — no real-time updates.

---

## 11. Non-Interactive Output (Markdown)

Function: `formatContextAsMarkdownTable(data: ContextData) → string`

Output is a structured markdown document with these sections:

### Header

```markdown
## Context Usage

**Model:** claude-opus-4-6[1m]
**Tokens:** 45.2k / 1M (5%)
```

### Context Strategy (if context collapse enabled)

```markdown
**Context strategy:** collapse (3 spans summarized (45 messages))
**Collapse errors:** 2/10 spawns failed (last: timeout after 30s)
**Collapse idle:** 5 consecutive empty runs
```

### Estimated Usage by Category

```markdown
### Estimated usage by category

| Category | Tokens | Percentage |
|----------|--------|------------|
| System prompt | 3.2k | 0.3% |
| System tools | 8.1k | 0.8% |
| Messages | 28.5k | 2.9% |
| Free space | 955.2k | 95.5% |
| Autocompact buffer | 33k | 3.3% |
```

### Detail Sections

Each rendered as markdown tables:

- **MCP Tools**: `| Tool | Server | Tokens |`
- **Custom Agents**: `| Agent Type | Source | Tokens |`
- **Memory Files**: `| Type | Path | Tokens |`
- **Skills**: `| Skill | Source | Tokens |`
- **Message Breakdown** (internal only): `| Category | Tokens |`
- **Top Tools** (internal only): `| Tool | Call Tokens | Result Tokens |`
- **Top Attachments** (internal only): `| Attachment | Tokens |`

### Agent Source Display Names

| Source key | Display |
|------------|---------|
| `projectSettings` | Project |
| `userSettings` | User |
| `localSettings` | Local |
| `flagSettings` | Flag |
| `policySettings` | Policy |
| `plugin` | Plugin |
| `built-in` | Built-in |

---

## 12. Context Suggestions

Function: `generateContextSuggestions(data: ContextData) → ContextSuggestion[]`

### 12.1 Thresholds

| Constant | Value | Description |
|----------|-------|-------------|
| `NEAR_CAPACITY_PERCENT` | **80** | Warn when context ≥ 80% full |
| `LARGE_TOOL_RESULT_PERCENT` | **15** | Tool result bloat threshold |
| `LARGE_TOOL_RESULT_TOKENS` | **10,000** | Minimum tokens to flag tool results |
| `READ_BLOAT_PERCENT` | **5** | Read result bloat threshold |
| `MEMORY_HIGH_PERCENT` | **5** | Memory file bloat threshold |
| `MEMORY_HIGH_TOKENS` | **5,000** | Minimum memory tokens to flag |

### 12.2 Suggestion Checks (in order)

#### 1. Near Capacity (`percentage >= 80%`)

- **Severity**: `warning`
- **If autocompact enabled**: "Use /compact now to control what gets kept"
- **If autocompact disabled**: "Use /compact or enable autocompact"

#### 2. Large Tool Results (`> 15% AND > 10k tokens`)

Per-tool checks with specific advice:

| Tool | Severity | Advice | Est. Savings |
|------|----------|--------|-------------|
| Bash results | `warning` | Use `head`, `tail`, `grep` to limit output | 50% |
| Read results | `info` | Use `offset`/`limit` parameters | 30% |
| Grep results | `info` | Refine pattern or use Glob | 30% |
| WebFetch results | `info` | Extract specific content | 40% |
| Generic (≥ 20%) | `info` | General reduction advice | 20% |

#### 3. Read Result Bloat (`≥ 5% AND ≥ 10k tokens`)

- **Severity**: `info`
- Only if not already flagged by large tool results check
- **Advice**: Reference earlier reads, use offset/limit

#### 4. Memory Bloat (`≥ 5% AND ≥ 5k tokens`)

- **Severity**: `info`
- Shows top 3 largest memory files
- **Advice**: Review with `/memory` command

#### 5. Autocompact Disabled (`50% ≤ usage < 80%`)

- **Severity**: `info`
- Only between 50-79% (near-capacity range is handled separately)
- **Advice**: Enable autocompact or use `/compact`

### 12.3 Sorting

```
1. Warnings first, then info
2. Within same severity: by savingsTokens descending
```

### 12.4 Suggestion Rendering

Each suggestion displays:

```
⚠ [title]  → save ~[savingsTokens]
  [detail text, dimmed]
```

- Status icon based on severity (warning/info)
- Bold title
- Optional savings indicator (only if `savingsTokens` is set)
- Indented detail text in dimmed color

---

## 13. Token Warnings

Separate from suggestions — shown inline in the conversation UI.

### Warning State Calculation

```
effectiveContextSize = contextWindow - min(maxOutputTokens, 20_000)
warningThreshold     = effectiveContextSize - 20_000
errorThreshold       = effectiveContextSize - 20_000
autoCompactThreshold = effectiveContextSize - 13_000
```

### Display Rules

| Condition | Display |
|-----------|---------|
| Below warning threshold | Nothing shown |
| Above warning, autocompact ON | `"{percentLeft}% until auto-compact"` (dimmed) |
| Above warning, autocompact OFF | `"Context low ({percentLeft}% remaining) · Run /compact"` (warning color) |
| Above error threshold | Same as warning but in error color |

---

## 14. Status Line Integration

The status line (persistent footer) includes context data:

### Context Window Section of Status Line Input

```typescript
context_window: {
  total_input_tokens: number       // From last API response
  total_output_tokens: number
  context_window_size: number      // From getContextWindowForModel()
  current_usage: number            // total input tokens
  used_percentage: number          // Calculated percentage
  remaining_percentage: number     // 100 - used
}
```

### Status Line Update Triggers

- Last assistant message ID changes
- Debounced by 500ms
- Runs via user-configured hook command
- Non-blocking (background execution)

---

## 15. Context Collapse / Compaction Integration

### Autocompact Constants

| Constant | Value |
|----------|-------|
| `AUTOCOMPACT_BUFFER_TOKENS` | 13,000 |
| `WARNING_THRESHOLD_BUFFER_TOKENS` | 20,000 |
| `ERROR_THRESHOLD_BUFFER_TOKENS` | 20,000 |
| `MANUAL_COMPACT_BUFFER_TOKENS` | 3,000 |
| `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES` | 3 |

### Context Collapse Status (shown in non-interactive output)

When context collapse is enabled, the output includes:

- **Strategy**: `"collapse"` with summary of collapsed/staged spans
- **Error count**: `"X/Y spawns failed"` with last error message (truncated to 80 chars)
- **Idle warning**: `"N consecutive empty runs"` if `emptySpawnWarningEmitted`

### Interaction with Grid

- When context collapse is enabled: reserved buffer is **skipped** (collapse manages its own thresholds)
- When reactive-only compaction: reserved buffer is **skipped**
- Only standard autocompact mode shows the buffer in the grid

---

## 16. Constants Reference

### Context Window

| Constant | Value |
|----------|-------|
| `MODEL_CONTEXT_WINDOW_DEFAULT` | 200,000 |
| `COMPACT_MAX_OUTPUT_TOKENS` | 20,000 |
| `MAX_OUTPUT_TOKENS_DEFAULT` | 32,000 |
| `MAX_OUTPUT_TOKENS_UPPER_LIMIT` | 64,000 |
| `CAPPED_DEFAULT_MAX_TOKENS` | 8,000 |
| `ESCALATED_MAX_TOKENS` | 64,000 |

### Token Counting

| Constant | Value |
|----------|-------|
| `TOOL_TOKEN_COUNT_OVERHEAD` | 500 |
| `TOKEN_COUNT_THINKING_BUDGET` | 1,024 |
| `TOKEN_COUNT_MAX_TOKENS` | 2,048 |

### Suggestions

| Constant | Value |
|----------|-------|
| `NEAR_CAPACITY_PERCENT` | 80 |
| `LARGE_TOOL_RESULT_PERCENT` | 15 |
| `LARGE_TOOL_RESULT_TOKENS` | 10,000 |
| `READ_BLOAT_PERCENT` | 5 |
| `MEMORY_HIGH_PERCENT` | 5 |
| `MEMORY_HIGH_TOKENS` | 5,000 |

### Compaction

| Constant | Value |
|----------|-------|
| `AUTOCOMPACT_BUFFER_TOKENS` | 13,000 |
| `WARNING_THRESHOLD_BUFFER_TOKENS` | 20,000 |
| `ERROR_THRESHOLD_BUFFER_TOKENS` | 20,000 |
| `MANUAL_COMPACT_BUFFER_TOKENS` | 3,000 |

### Token Formatting

Tokens are displayed using `formatTokens()`:

| Range | Format | Example |
|-------|--------|---------|
| < 1,000 | Raw number | `850` |
| ≥ 1,000 | `Xk` with 1 decimal | `3.2k` |
| ≥ 1,000,000 | `XM` with 1 decimal | `1.0M` |

---

## 17. Integration Points

### Inputs Your Implementation Needs

| Dependency | What It Provides |
|------------|------------------|
| **Message store** | Current conversation messages (with tool use IDs) |
| **Model registry** | Model name → context window size, max output tokens |
| **Tool registry** | List of registered tools with schemas |
| **MCP connections** | List of MCP tools with server names |
| **Agent definitions** | Custom agent configs (type, whenToUse, source) |
| **Memory/config files** | CLAUDE.md equivalent files with paths |
| **Skill registry** | Loaded skills with frontmatter |
| **API response cache** | Last API response's `usage` field |
| **Compaction state** | Whether autocompact is enabled, current threshold |
| **Terminal info** | Terminal width for responsive grid |
| **Token counting service** | API-based or estimation-based token counter |

### Outputs

| Consumer | What It Reads |
|----------|---------------|
| **Terminal UI** | Grid visualization (ANSI colored) |
| **SDK/API clients** | Markdown table (non-interactive) |
| **Status line** | Context percentage, token counts |
| **Token warning** | Warning/error state for inline display |

---

## 18. Implementation Checklist

### Phase 1: Core Data Model
- [ ] Define `ContextData`, `ContextCategory`, `GridSquare`, `ContextSuggestion` types
- [ ] Define `MessageBreakdown`, `MemoryFile`, `McpTool`, `Agent`, `SkillInfo` types
- [ ] Implement `formatTokens()` utility

### Phase 2: Context Window Resolution
- [ ] Implement `getContextWindowForModel()` with priority chain
- [ ] Implement `getMaxOutputTokensForModel()` per model family
- [ ] Implement `calculateContextPercentages()`

### Phase 3: Token Counting
- [ ] Implement primary token counting (API-based)
- [ ] Implement fallback estimation (`content.length / 4`)
- [ ] Implement tool overhead subtraction (500 tokens)
- [ ] Implement API usage extraction from last response

### Phase 4: Context Analysis
- [ ] Implement `countSystemTokens()` — parse markdown headings, count per-section
- [ ] Implement `countMemoryFileTokens()` — per-file counting
- [ ] Implement `countBuiltInToolTokens()` — always-loaded vs. deferred
- [ ] Implement `countMcpToolTokens()` — bulk counting, per-tool estimation
- [ ] Implement `countCustomAgentTokens()` — agentType + whenToUse
- [ ] Implement `countSkillTokens()` — frontmatter only, error-isolated
- [ ] Implement `approximateMessageTokens()` — per-content-block breakdown
- [ ] Implement `analyzeContextUsage()` — orchestrator with `Promise.all`

### Phase 5: Grid Visualization
- [ ] Implement responsive grid sizing (4 size configurations)
- [ ] Implement square allocation (proportional, min 1 for non-free)
- [ ] Implement partial square fullness
- [ ] Implement square rendering order (content → free → reserved)

### Phase 6: Suggestions
- [ ] Implement 5 suggestion checks with thresholds
- [ ] Implement per-tool-type advice (Bash, Read, Grep, WebFetch, generic)
- [ ] Implement suggestion sorting (severity, then savings)

### Phase 7: Interactive Rendering
- [ ] Implement two-column layout (grid left, details right)
- [ ] Implement category legend with symbols, tokens, percentages
- [ ] Implement detail sections (MCP tools, agents, memory, skills)
- [ ] Implement suggestion rendering
- [ ] Implement color theming

### Phase 8: Non-Interactive Rendering
- [ ] Implement markdown table formatter
- [ ] Implement all detail table sections
- [ ] Implement context collapse status reporting

### Phase 9: Status Line & Warnings
- [ ] Implement status line data builder (context_window section)
- [ ] Implement token warning state calculation
- [ ] Implement warning display logic (autocompact-aware)

### Phase 10: Integration
- [ ] Wire up message pipeline transforms (compact boundary, microcompact)
- [ ] Wire up command registration (interactive + non-interactive)
- [ ] Wire up status line updates (debounced, on message change)
- [ ] Wire up token warning display in conversation UI