# Porting `TodoWrite`, `EnterPlanMode`, `ExitPlanMode`

Self-contained guide for reimplementing Claude Code's plan/todo tools in another agent harness (any stack, any language). All prompts, schemas, and result strings are inlined below — no external source access needed.

---

## 1. Mental model

Two independent features, often used together.

**TodoWrite** = single mutable task checklist the model writes to. Tool input *replaces* whole list. Host reads it back at turn boundaries and reinjects it as a reminder so the model keeps tracking. Pure agent-state tool. No permissions, no UI dialog.

**EnterPlanMode / ExitPlanMode** = permission-mode toggle. Enter switches agent into a read-only "plan" mode (writes blocked). Model explores, writes a plan file to disk. Exit presents plan to user for approval, restores prior mode, resumes coding.

Todos live in memory (per-session, per-agent). Plan lives on disk as a Markdown file keyed by a slug.

---

## 2. Data contracts

### 2.1 Todo item

```ts
TodoItem = {
  content: string     // imperative: "Run tests" — non-empty
  activeForm: string  // present-continuous: "Running tests" — non-empty
  status: 'pending' | 'in_progress' | 'completed'
}
TodoList = TodoItem[]
```

Invariants enforced by prompt (not schema):
- Exactly one `in_progress` at any time
- Mark `completed` only when fully done
- Never complete if tests fail / impl partial / errors unresolved

### 2.2 Plan file

Plain Markdown on disk. Path layout:

```
<plansDir>/<slug>.md                    # main session
<plansDir>/<slug>-agent-<agentId>.md    # subagent
```

`plansDir` default: `$CLAUDE_CONFIG_HOME/plans/` (e.g. `~/.claude/plans/`). Configurable via a `plansDirectory` setting resolved relative to project cwd. **Must reject paths that escape cwd** (path-traversal guard). On config error, fall back to the default.

`slug` = random word-slug (two-word kebab e.g. `brave-lion`) generated lazily on first plan-file access. Retry up to 10 times if filename collides. Cache per `sessionId` so a session keeps the same file. On session resume, restore slug from transcript metadata.

---

## 3. TodoWrite tool

### 3.1 Tool definition

```
name:        "TodoWrite"
description: (see §3.2 — short description shown in tool catalog)
prompt:      (see §3.3 — long usage guide given to model)
input:       { todos: TodoList }      // strict: reject extra keys
output:      { oldTodos: TodoList, newTodos: TodoList,
               verificationNudgeNeeded?: boolean }
permission:  always allow (no user prompt)
user-facing: hidden tool-use message (renderToolUseMessage returns null)
```

### 3.2 Short description (tool catalog line)

```
Update the todo list for the current session. To be used proactively and
often to track progress and pending tasks. Make sure that at least one task
is in_progress at all times. Always provide both content (imperative) and
activeForm (present continuous) for each task.
```

### 3.3 Long prompt (model-facing usage guide)

Copy verbatim:

````
Use this tool to create and manage a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool
Use this tool proactively in these scenarios:

1. Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
2. Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
3. User explicitly requests todo list - When the user directly asks you to use the todo list
4. User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
5. After receiving new instructions - Immediately capture user requirements as todos
6. When you start working on a task - Mark it as in_progress BEFORE beginning work. Ideally you should only have one todo as in_progress at a time
7. After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation

## When NOT to Use This Tool

Skip using this tool when:
1. There is only a single, straightforward task
2. The task is trivial and tracking it provides no organizational benefit
3. The task can be completed in less than 3 trivial steps
4. The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.

## Examples of When to Use the Todo List

<example>
User: I want to add a dark mode toggle to the application settings. Make sure you run the tests and build when you're done!
Assistant: *Creates todo list with the following items:*
1. Creating dark mode toggle component in Settings page
2. Adding dark mode state management (context/store)
3. Implementing CSS-in-JS styles for dark theme
4. Updating existing components to support theme switching
5. Running tests and build process, addressing any failures or errors that occur
*Begins working on the first task*

<reasoning>
The assistant used the todo list because:
1. Adding dark mode is a multi-step feature requiring UI, state management, and styling changes
2. The user explicitly requested tests and build be run afterward
3. The assistant inferred that tests and build need to pass by adding "Ensure tests and build succeed" as the final task
</reasoning>
</example>

<example>
User: Help me rename the function getCwd to getCurrentWorkingDirectory across my project
Assistant: *Uses grep or search tools to locate all instances of getCwd in the codebase*
I've found 15 instances of 'getCwd' across 8 different files.
*Creates todo list with specific items for each file that needs updating*

<reasoning>
The assistant used the todo list because:
1. First, the assistant searched to understand the scope of the task
2. Upon finding multiple occurrences across different files, it determined this was a complex task with multiple steps
3. The todo list helps ensure every instance is tracked and updated systematically
4. This approach prevents missing any occurrences and maintains code consistency
</reasoning>
</example>


<example>
User: I need to implement these features for my e-commerce site: user registration, product catalog, shopping cart, and checkout flow.
Assistant: *Creates a todo list breaking down each feature into specific tasks based on the project architecture*
Let's start with user registration. This will involve creating database models, API endpoints, and frontend forms that integrate with your existing authentication system.

<reasoning>
The assistant used the todo list because:
1. The user provided multiple complex features to implement in a comma separated list
2. The todo list helps organize these large features into manageable tasks
3. This approach allows for tracking progress across the entire implementation
</reasoning>
</example>

<example>
User: Can you help optimize my React application? It's rendering slowly and has performance issues.
Assistant: *Reviews component structure, render patterns, state management, and data fetching*
After analyzing your codebase, I've identified several performance issues.
*Creates todo list with items like: 1) Implementing memoization for expensive calculations in ProductList, 2) Adding virtualization for long lists in Dashboard, 3) Optimizing image loading in Gallery component, 4) Fixing state update loops in ShoppingCart, 5) Reviewing bundle size and implementing code splitting*
Let's start by implementing memoization for the expensive calculations in your ProductList component.

<reasoning>
The assistant used the todo list because:
1. First, the assistant examined the codebase to identify specific performance issues
2. Based on this analysis, it identified multiple optimization opportunities
3. Performance optimization is a non-trivial task requiring multiple steps
4. The todo list helps methodically track improvements across different components
5. This systematic approach ensures all performance bottlenecks are addressed
</reasoning>
</example>

## Examples of When NOT to Use the Todo List

<example>
User: How do I print 'Hello World' in Python?
Assistant: In Python, you can print "Hello World" with this simple code:

python
print("Hello World")

This will output the text "Hello World" to the console when executed.

<reasoning>
The assistant did not use the todo list because this is a single, trivial task that can be completed in one step. There's no need to track multiple tasks or steps for such a straightforward request.
</reasoning>
</example>

<example>
User: What does the git status command do?
Assistant: The git status command shows the current state of your working directory and staging area. It displays which changes have been staged, which haven't, and which files aren't being tracked by Git. This is a fundamental command for understanding the current state of your repository before making commits.

<reasoning>
The assistant did not use the todo list because this is an informational request with no actual coding task to complete. The user is simply asking for an explanation, not for the assistant to perform multiple steps or tasks.
</reasoning>
</example>

<example>
User: Can you add a comment to the calculateTotal function to explain what it does?
Assistant: Sure, let me add a comment to the calculateTotal function to explain what it does.
* Uses the <FILE_EDIT_TOOL_NAME> tool to add a comment to the calculateTotal function *

<reasoning>
The assistant did not use the todo list because this is a single, straightforward task confined to one location in the code. Adding a comment doesn't require tracking multiple steps or systematic organization.
</reasoning>
</example>

<example>
User: Run npm install for me and tell me what happens.
Assistant: I'll run the npm install command for you.

*Executes: npm install*

The command completed successfully. Here's the output:
[Output of npm install command]

All dependencies have been installed according to your package.json file.

<reasoning>
The assistant did not use the todo list because this is a single command execution with immediate results. There are no multiple steps to track or organize, making the todo list unnecessary for this straightforward task.
</reasoning>
</example>

## Task States and Management

1. **Task States**: Use these states to track progress:
   - pending: Task not yet started
   - in_progress: Currently working on (limit to ONE task at a time)
   - completed: Task finished successfully

   **IMPORTANT**: Task descriptions must have two forms:
   - content: The imperative form describing what needs to be done (e.g., "Run tests", "Build the project")
   - activeForm: The present continuous form shown during execution (e.g., "Running tests", "Building the project")

2. **Task Management**:
   - Update task status in real-time as you work
   - Mark tasks complete IMMEDIATELY after finishing (don't batch completions)
   - Exactly ONE task must be in_progress at any time (not less, not more)
   - Complete current tasks before starting new ones
   - Remove tasks that are no longer relevant from the list entirely

3. **Task Completion Requirements**:
   - ONLY mark a task as completed when you have FULLY accomplished it
   - If you encounter errors, blockers, or cannot finish, keep the task as in_progress
   - When blocked, create a new task describing what needs to be resolved
   - Never mark a task as completed if:
     - Tests are failing
     - Implementation is partial
     - You encountered unresolved errors
     - You couldn't find necessary files or dependencies

4. **Task Breakdown**:
   - Create specific, actionable items
   - Break complex tasks into smaller, manageable steps
   - Use clear, descriptive task names
   - Always provide both forms:
     - content: "Fix authentication bug"
     - activeForm: "Fixing authentication bug"

When in doubt, use this tool. Being proactive with task management demonstrates attentiveness and ensures you complete all requirements successfully.
````

Replace `<FILE_EDIT_TOOL_NAME>` with the name of your file-edit tool.

### 3.4 `call()` logic

```
1. key      = context.agentId ?? sessionId
2. oldTodos = state.todos[key] ?? []
3. if todos.length > 0 and every todo.status === 'completed':
       newPersisted = []        # clear when whole list done
   else:
       newPersisted = todos
4. state.todos[key] = newPersisted
5. return {
     oldTodos,
     newTodos: todos,            # original list (not newPersisted)
     verificationNudgeNeeded,    # optional; see §3.6
   }
```

Step 3 is important: persisted list clears on full completion, but the returned `newTodos` keeps the original items so the model sees what it just finished.

### 3.5 Tool-result content

Base string (always):

```
Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable
```

Append verification nudge if `verificationNudgeNeeded` (§3.6):

```


NOTE: You just closed out 3+ tasks and none of them was a verification step. Before writing your final summary, spawn the verification agent (subagent_type="<VERIFICATION_AGENT_TYPE>"). You cannot self-assign PARTIAL by listing caveats in your summary — only the verifier issues a verdict.
```

### 3.6 `verificationNudgeNeeded` (optional feature)

Skip if you don't have a verification subagent. Fires when all of:

- Call is from main agent (no `agentId`)
- All submitted todos are `completed`
- Count ≥ 3
- None of the todos' `content` matches regex `/verif/i`

Purpose: catch "I'll summarize caveats instead of verifying" failure mode.

### 3.7 Storage

In-memory session store, keyed by `agentId ?? sessionId`:

```
state.todos: { [agentKey: string]: TodoList }
```

Per-agent so subagents get their own list. **No disk persistence.** On session resume, rehydrate from transcript (find most recent TodoWrite tool_use input).

### 3.8 Reminder attachment (makes the tool actually work)

Without this, the model forgets to use the todo list. Host injects a `todo_reminder` user message at turn boundaries when the list is stale.

Inject when: current list is non-empty AND last `todo_reminder` is more than N messages ago AND the model did non-trivial work without calling TodoWrite.

Message body (wrap in `<system-reminder>` tags so user UI hides it):

```
The TodoWrite tool hasn't been used recently. If you're working on tasks that would benefit from tracking progress, consider using the TodoWrite tool to track progress. Also consider cleaning up the todo list if has become stale and no longer matches what you are working on. Only use it if it's relevant to the current work. This is just a gentle reminder - ignore if not applicable. Make sure that you NEVER mention this reminder to the user


Here are the existing contents of your todo list:

[1. [pending] Run tests
2. [in_progress] Fix auth bug
3. [completed] Add logging]
```

Format one todo per line as `<index>. [<status>] <content>`, joined with newlines, wrapped in `[...]`.

---

## 4. EnterPlanMode tool

### 4.1 Tool definition

```
name:             "EnterPlanMode"
description:      "Requests permission to enter plan mode for complex
                   tasks requiring exploration and design"
input:            {} (no parameters — strict, reject extra keys)
output:           { message: string }
readonly:         true
concurrencySafe:  true
permission:       always allow (no prompt; plan mode is safe to enter)
forbidden_in:     subagent contexts (throw if agentId set)
```

### 4.2 Long prompt (model-facing)

Copy verbatim. Replace `<ASK_USER_QUESTION_TOOL_NAME>` with the name of your clarifying-question tool (if any); otherwise delete the mentions.

````
Use this tool proactively when you're about to start a non-trivial implementation task. Getting user sign-off on your approach before writing code prevents wasted effort and ensures alignment. This tool transitions you into plan mode where you can explore the codebase and design an implementation approach for user approval.

## When to Use This Tool

**Prefer using EnterPlanMode** for implementation tasks unless they're simple. Use it when ANY of these conditions apply:

1. **New Feature Implementation**: Adding meaningful new functionality
   - Example: "Add a logout button" - where should it go? What should happen on click?
   - Example: "Add form validation" - what rules? What error messages?

2. **Multiple Valid Approaches**: The task can be solved in several different ways
   - Example: "Add caching to the API" - could use Redis, in-memory, file-based, etc.
   - Example: "Improve performance" - many optimization strategies possible

3. **Code Modifications**: Changes that affect existing behavior or structure
   - Example: "Update the login flow" - what exactly should change?
   - Example: "Refactor this component" - what's the target architecture?

4. **Architectural Decisions**: The task requires choosing between patterns or technologies
   - Example: "Add real-time updates" - WebSockets vs SSE vs polling
   - Example: "Implement state management" - Redux vs Context vs custom solution

5. **Multi-File Changes**: The task will likely touch more than 2-3 files
   - Example: "Refactor the authentication system"
   - Example: "Add a new API endpoint with tests"

6. **Unclear Requirements**: You need to explore before understanding the full scope
   - Example: "Make the app faster" - need to profile and identify bottlenecks
   - Example: "Fix the bug in checkout" - need to investigate root cause

7. **User Preferences Matter**: The implementation could reasonably go multiple ways
   - If you would use <ASK_USER_QUESTION_TOOL_NAME> to clarify the approach, use EnterPlanMode instead
   - Plan mode lets you explore first, then present options with context

## When NOT to Use This Tool

Only skip EnterPlanMode for simple tasks:
- Single-line or few-line fixes (typos, obvious bugs, small tweaks)
- Adding a single function with clear requirements
- Tasks where the user has given very specific, detailed instructions
- Pure research/exploration tasks (use the Agent tool with explore agent instead)

## What Happens in Plan Mode

In plan mode, you'll:
1. Thoroughly explore the codebase using Glob, Grep, and Read tools
2. Understand existing patterns and architecture
3. Design an implementation approach
4. Present your plan to the user for approval
5. Use <ASK_USER_QUESTION_TOOL_NAME> if you need to clarify approaches
6. Exit plan mode with ExitPlanMode when ready to implement

## Examples

### GOOD - Use EnterPlanMode:
User: "Add user authentication to the app"
- Requires architectural decisions (session vs JWT, where to store tokens, middleware structure)

User: "Optimize the database queries"
- Multiple approaches possible, need to profile first, significant impact

User: "Implement dark mode"
- Architectural decision on theme system, affects many components

User: "Add a delete button to the user profile"
- Seems simple but involves: where to place it, confirmation dialog, API call, error handling, state updates

User: "Update the error handling in the API"
- Affects multiple files, user should approve the approach

### BAD - Don't use EnterPlanMode:
User: "Fix the typo in the README"
- Straightforward, no planning needed

User: "Add a console.log to debug this function"
- Simple, obvious implementation

User: "What files handle routing?"
- Research task, not implementation planning

## Important Notes

- This tool REQUIRES user approval - they must consent to entering plan mode
- If unsure whether to use it, err on the side of planning - it's better to get alignment upfront than to redo work
- Users appreciate being consulted before significant changes are made to their codebase
````

### 4.3 `call()` logic

```
1. if context.agentId: throw Error("EnterPlanMode cannot be used in agent contexts")
2. record transition(oldMode, 'plan')   # fires attachment flags — §6
3. state.toolPermissionContext.prePlanMode = current mode
   state.toolPermissionContext.mode       = 'plan'
   (if current mode was "auto" and you support it:
      - deactivate auto
      - strip dangerous perm rules, remember them as strippedDangerousRules)
4. return { message: "Entered plan mode. You should now focus on exploring
                      the codebase and designing an implementation approach." }
```

### 4.4 Tool-result content

```
Entered plan mode. You should now focus on exploring the codebase and designing an implementation approach.

In plan mode, you should:
1. Thoroughly explore the codebase to understand existing patterns
2. Identify similar features and architectural approaches
3. Consider multiple approaches and their trade-offs
4. Use AskUserQuestion if you need to clarify the approach
5. Design a concrete implementation strategy
6. When ready, use ExitPlanMode to present your plan for approval

Remember: DO NOT write or edit any files yet. This is a read-only exploration and planning phase.
```

### 4.5 Mode enforcement

Plan mode is enforced by the **permission system**, not by prompt alone. While `mode === 'plan'`, block every write-capable tool:

- File write / edit / create → block
- Bash (or equivalent shell) with side effects → block
- Any tool that mutates external state → block

Allow: Read, Grep, Glob, WebFetch, Web search, AskUserQuestion, ExitPlanMode, and a designated plan-file-write path (see §5.2 option A).

If the model attempts a forbidden tool, return an error that reminds it it's in plan mode.

---

## 5. ExitPlanMode tool

### 5.1 Tool definition

```
name:        "ExitPlanMode"
description: "Prompts the user to exit plan mode and start coding"
prompt:      (see §5.2)
input:       {
               allowedPrompts?: [         // optional; semantic permission asks
                 { tool: "Bash", prompt: string }
               ]
             }
             // plus injected by normalizer (see §5.3):
             // plan?: string, planFilePath?: string
output:      {
               plan: string | null,
               isAgent: boolean,
               filePath?: string,
               hasTaskTool?: boolean,
               planWasEdited?: boolean,
             }
readonly:    false
permission:  ask user ("Exit plan mode?")  — dialog shows plan contents
```

### 5.2 Long prompt (model-facing)

Copy verbatim. Replace `<ASK_USER_QUESTION_TOOL_NAME>`.

````
Use this tool when you are in plan mode and have finished writing your plan to the plan file and are ready for user approval.

## How This Tool Works
- You should have already written your plan to the plan file specified in the plan mode system message
- This tool does NOT take the plan content as a parameter - it will read the plan from the file you wrote
- This tool simply signals that you're done planning and ready for the user to review and approve
- The user will see the contents of your plan file when they review it

## When to Use This Tool
IMPORTANT: Only use this tool when the task requires planning the implementation steps of a task that requires writing code. For research tasks where you're gathering information, searching files, reading files or in general trying to understand the codebase - do NOT use this tool.

## Before Using This Tool
Ensure your plan is complete and unambiguous:
- If you have unresolved questions about requirements or approach, use <ASK_USER_QUESTION_TOOL_NAME> first (in earlier phases)
- Once your plan is finalized, use THIS tool to request approval

**Important:** Do NOT use <ASK_USER_QUESTION_TOOL_NAME> to ask "Is this plan okay?" or "Should I proceed?" - that's exactly what THIS tool does. ExitPlanMode inherently requests user approval of your plan.

## Examples

1. Initial task: "Search for and understand the implementation of vim mode in the codebase" - Do not use the exit plan mode tool because you are not planning the implementation steps of a task.
2. Initial task: "Help me implement yank mode for vim" - Use the exit plan mode tool after you have finished planning the implementation steps of the task.
3. Initial task: "Add a new feature to handle user authentication" - If unsure about auth method (OAuth, JWT, etc.), use <ASK_USER_QUESTION_TOOL_NAME> first, then use exit plan mode tool after clarifying the approach.
````

### 5.3 Plan-file flow (two options)

**A. File-based (recommended).**
- When entering plan mode, inject a system-reminder telling the model the exact plan file path: `Write your plan to <planFilePath>`.
- Allow file writes **only** to that one path while in plan mode.
- ExitPlanMode reads plan from disk in `call()`.
- Preserves an "edit before approve" UX (user can tweak the plan in their editor or approval dialog).

**B. Inline.**
- Make `plan: string` a required tool input.
- Simpler to implement but loses the edit-on-approve UX and makes plans hard to reference later.

### 5.4 Input normalizer (if using option A)

Before the model's tool call reaches hooks/SDK, normalize by reading the plan from disk and injecting:

```
input.plan         = readFile(planFilePath)   // may be "" if missing
input.planFilePath = planFilePath
```

This way hooks and the SDK see the plan content. Internal `call()` can still re-read from disk as source of truth.

### 5.5 `validateInput`

Reject if `state.toolPermissionContext.mode !== 'plan'`. Error:

```
You are not in plan mode. This tool is only for exiting plan mode after writing a plan. If your plan was already approved, continue with implementation.
```

Why: the tool is announced in the tool catalog regardless of mode (so the model knows it exists after context clear). Validate-before-permission prevents a stray approval dialog from flashing when called outside plan mode.

### 5.6 `checkPermissions`

```
behavior: "ask"
message:  "Exit plan mode?"
```

User sees the plan contents in the approval dialog. Three outcomes:

- **Approve** → tool proceeds with `input.plan` unchanged. `planWasEdited = false`.
- **Edit** → user edits plan in dialog. Tool proceeds with new `input.plan`. Set `planWasEdited = true`. Tool must write edited plan back to disk.
- **Reject** → tool call rejected. Model stays in plan mode.

### 5.7 `call()` logic

```
1. plan = input.plan ?? readFile(planFilePath)     # fallback to disk
2. if input.plan was provided and differs from disk:
       writeFile(planFilePath, input.plan)          # sync disk with edit
3. Restore permission mode:
       restoreMode = prePlanMode ?? 'default'
       (auto-mode gate fallback: if prePlanMode was 'auto' but auto-mode
        gate is currently off, use 'default' instead and notify user)
       state.toolPermissionContext.mode            = restoreMode
       state.toolPermissionContext.prePlanMode     = undefined
       restore strippedDangerousRules if set (unless restoring to auto)
4. state.hasExitedPlanMode = true
5. Queue "plan_mode_exit" attachment for the next turn (§6)
6. return { plan, isAgent: !!agentId, filePath, planWasEdited }
```

### 5.8 Tool-result content

**Case 1 — main user, non-empty plan:**

```
User has approved your plan. You can now start coding. Start with updating your todo list if applicable

Your plan has been saved to: <filePath>
You can refer back to it if needed during implementation.

## Approved Plan:
<plan>
```

If `planWasEdited`, change the header to:

```
## Approved Plan (edited by user):
```

**Case 2 — subagent context (agentId set):**

```
User has approved the plan. There is nothing else needed from you now. Please respond with "ok"
```

**Case 3 — empty/missing plan:**

```
User has approved exiting plan mode. You can now proceed.
```

---

## 6. Permission-mode state machine

Minimum state:

```
toolPermissionContext = {
  mode: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions' | 'auto',
  prePlanMode: <previous mode, only set while in plan>,
  strippedDangerousRules: <saved rules to restore on exit, if applicable>,
}
```

Transitions:

```
enter_plan:  mode=X     -> mode='plan', prePlanMode=X
exit_plan:   mode='plan'-> mode=prePlanMode, prePlanMode=undefined
```

On both transitions, set an attachment flag so the next user turn gets a system reminder:

- **Entering plan** → `needsPlanModeAttachment = true`. Next turn, prepend a system-reminder explaining the mode and (for option A) naming the plan file path.
- **Exiting plan** → `needsPlanModeExitAttachment = true`. Next turn, prepend a system-reminder noting the mode change (approved plan now in effect).

If the user toggles in/out rapidly, clear the opposing flag so you don't send both reminders.

---

## 7. UI hooks

Reference impl uses a TUI (Ink). For any frontend:

- **EnterPlanMode tool call** → show "Entered plan mode" indicator. Style subsequent tool-use messages under plan-mode branding until exit.
- **EnterPlanMode rejected** → render "User declined to enter plan mode".
- **ExitPlanMode tool call** → show approval dialog with plan contents rendered as Markdown. Buttons: Approve / Edit / Reject.
- **Todo list** → no tool-use message needed (render as null). Optionally show a persistent sidebar reflecting `state.todos[session]`.

---

## 8. Session resume / transcript recovery

Todos and plans must survive session resume.

**Todos:** scan transcript backwards for the most recent TodoWrite tool_use input; restore `state.todos[key] = that list`.

**Plan slug:** persist the slug in every message (a `slug` field on user/assistant messages works). On resume, read the first message with a slug and call `setPlanSlug(sessionId, slug)`.

**Plan file content:** if `<plansDir>/<slug>.md` exists, done. If missing (common in remote/ephemeral environments), try three recovery sources, in order:

1. **File-snapshot system messages.** If you periodically write a `file_snapshot` system message into the transcript with `{key: 'plan', path, content}`, scan backwards for the most recent one and restore.
2. **ExitPlanMode tool_use inputs.** Scan backwards; if any assistant message has a `tool_use` block named `ExitPlanMode` with `input.plan` set, use that.
3. **User `planContent` / `plan_file_reference` attachments.** Scan backwards for user messages carrying the plan content inline.

If any source yields a non-empty plan, write it to the plan file path and continue.

---

## 9. Porting checklist

1. **Schemas** — `TodoItem` / `TodoList`; `Plan` is just `string`.
2. **State store** — add `todos: { [agentKey]: TodoList }`, `toolPermissionContext` with `mode` + `prePlanMode`.
3. **Plan storage** — dir resolver (with path-traversal guard), slug generator (10-retry on collision), path builder with `-agent-<id>` suffix, slug cache keyed by `sessionId`.
4. **Permission system** — add `'plan'` mode; block all write tools; allow the designated plan-file path only.
5. **TodoWrite tool** — implement §3. Paste prompt (§3.3) verbatim.
6. **EnterPlanMode tool** — implement §4. Paste prompt (§4.2) verbatim. Fail hard if called from a subagent.
7. **ExitPlanMode tool** — implement §5. Paste prompt (§5.2) verbatim. Wire approval dialog (approve / edit / reject).
8. **Input normalizer** — on every ExitPlanMode tool_use, inject `plan` + `planFilePath` from disk before hooks/SDK see it.
9. **Mode-transition attachments** — plan-mode enter reminder (with file path) and exit reminder.
10. **Todo reminder attachment** — inject per §3.8, rate-limited.
11. **Deferred-tool announcement** — announce ExitPlanMode in the tool catalog regardless of mode; rely on `validateInput` (§5.5) to gate.
12. **Transcript recovery** — per §8.

---

## 10. Gotchas

- **Don't persist todos to disk.** They're session-scoped. Rehydrate from transcript on resume.
- **Clear todos on all-completed.** Prevents stale checkmarks leaking into the next task. Return the original list to the model even though you persist an empty one.
- **Path traversal on `plansDirectory`.** Resolve against cwd, verify the resolved path stays inside cwd, fall back to default on violation.
- **Subagent todos/plans are separate.** Key by `agentId ?? sessionId`. Subagent ExitPlanMode returns a different result (§5.8 Case 2).
- **ExitPlanMode outside plan mode** must short-circuit in `validateInput`, not in `checkPermissions` — otherwise the approval dialog flashes before rejection.
- **Auto-mode gate fallback.** If you support an "auto" permission mode with a circuit breaker, exiting plan mode when auto gate is off must restore to `'default'` and notify the user. Skip if you don't have auto mode.
- **One in-progress todo** — enforced by prompt, not schema. Don't over-engineer validation; trust the prompt.
- **Reminder spam.** Rate-limit `todo_reminder` (track last-reminder index; don't fire if one is already in the last N turns).
- **Empty plan on ExitPlanMode** — return the "approved exiting plan mode" message (§5.8 Case 3) rather than crashing.
- **Sync disk after edit-on-approve.** If the user edits the plan in the approval dialog, write it back before continuing — downstream tools (verifiers, Read) will read from disk.
- **Plan mode from subagent** — disallowed. Throw in EnterPlanMode if `agentId` is set; subagents inherit the parent's mode.
- **Don't mock plan-mode enforcement in the prompt.** Actual permission-system blocking is what makes plan mode real. The "DO NOT write or edit any files" text is a reinforcement, not a primary gate.
