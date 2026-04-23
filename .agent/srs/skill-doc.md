# Skill System — Implementation Guide

This doc captures the design of the Claude Code "skill" system so you can build an equivalent subsystem in another repo/stack. It is stack-agnostic: the reference impl is TypeScript + Node/Bun, but the concepts port to Python, Go, Rust, etc. Filenames referenced are in the reference impl for anchoring — treat them as examples, not requirements.

---

## 1. What is a skill?

A **skill** is a named, declarative, Markdown-authored prompt fragment that extends the agent without code changes. At runtime:

1. The skill's _name + short description_ is advertised to the model (turn-0 listing).
2. The model (or user) invokes it by name through a dedicated tool (the `Skill` tool) or a slash command (`/skillname`).
3. The system loads the skill's full Markdown body, performs substitutions, and injects it into the conversation as a user-meta message — the model then "reads" the instructions and acts.

Skills are lazy: full bodies are NOT loaded into context until invoked. Only name + description + `whenToUse` are paid for turn-0.

Three kinds of skill, all producing the same runtime `Command` record:

| Source                           | Origin                                          | Typical use                                     |
| -------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| **Disk**                         | `<root>/skills/<name>/SKILL.md`                 | User-, project-, policy-, or plugin-authored    |
| **Bundled**                      | Registered programmatically at startup          | Ships inside the CLI binary (Anthropic-curated) |
| **MCP**                          | Discovered via MCP server prompts               | Extended by MCP-server authors                  |
| **Legacy commands** _(optional)_ | `<root>/commands/<name>.md` or `<dir>/SKILL.md` | Backwards-compat, deprecated                    |

---

## 2. Disk layout

Canonical directory form, **required** for the `skills/` loader:

```
<some-root>/
  skills/
    <skill-name>/              # name = directory name
      SKILL.md                 # REQUIRED. Frontmatter + markdown body.
      any/other/files.py       # optional assets, readable via ${CLAUDE_SKILL_DIR}
      schemas/foo.json
```

Single-file `.md` skills are NOT supported in `skills/`. Only `<dir>/SKILL.md` (the dir name becomes the skill name).

Roots the loader walks (in precedence order — first-wins dedup by resolved path):

1. **Managed / policy**: e.g. `<managed-root>/.claude/skills/` — locked by admin.
2. **User**: `~/.claude/skills/` (or `$CLAUDE_CONFIG_HOME/skills/`).
3. **Project**: walk up from cwd to `$HOME`, collecting every `.claude/skills/` dir on the way (so a repo sub-dir can override).
4. **Additional dirs**: `--add-dir <x>` → `<x>/.claude/skills/`.
5. **Plugin-supplied**: plugins may contribute skill dirs — same loader.

Environment flags in the reference impl (copy whichever are useful):

- `CLAUDE_CODE_DISABLE_POLICY_SKILLS=1` — skip the managed root.
- Bare mode — skip auto-discovery; only `--add-dir` loads.
- A "skills-locked / plugin-only" policy — hide project/user/legacy, keep plugin.

---

## 3. SKILL.md format

Standard YAML frontmatter, then Markdown body.

````markdown
---
name: My Skill # optional display name; dir name is the canonical id
description: One-line summary shown in listing.
when_to_use: Use when the user asks about X or Y.
argument-hint: '<file>'
arguments: [path, flag] # named args, substituted in body as $path / $flag
allowed-tools: [Bash, Read, Grep] # tools auto-allowed while this skill runs
model: opus # override main-loop model for this skill (or "inherit")
effort: medium # or integer budget
disable-model-invocation: false # true ⇒ Skill tool cannot invoke it (user-only)
user-invocable: true # false ⇒ hidden from slash-command UI (model-only)
context: fork # "fork" ⇒ run in isolated sub-agent; else inline
agent: my-agent-type # which agent definition fork inherits from
version: 1.2.0
hooks: { ... } # same schema as settings.json hooks
paths: ['src/**/*.py', '!**/test_*'] # conditional activation, gitignore-style
shell: { ... } # constrain !`…` execution
---

# Body

Free-form Markdown. You may embed:

- `${CLAUDE_SKILL_DIR}` — absolute path to this skill's directory (for asset refs)
- `${CLAUDE_SESSION_ID}`
- `$1`, `$2`, `$ARGUMENTS`, or named `$path`, `$flag` from `arguments:`
- Inline shell: !`echo hi` or fenced:

      ```!
      git status
      ```

  These run BEFORE the prompt is sent, and their stdout is spliced into the body. Disabled for MCP skills (untrusted).
````

Description fallback: if `description:` is missing, take the first meaningful sentence of the body under the first heading.

---

## 4. Runtime data model

Every loader produces the same normalized record. In TS it is named `Command` but the shape is essentially:

```ts
type Skill = {
  type: 'prompt';
  name: string; // dir/file name; canonical id
  userFacingName(): string; // display name (frontmatter `name:` fallback to id)
  description: string;
  whenToUse?: string;
  aliases?: string[];
  argumentHint?: string;
  argNames?: string[];
  allowedTools: string[];
  model?: string; // string like "opus" / "sonnet" / alias with [1m]
  effort?: EffortValue;
  context?: 'inline' | 'fork';
  agent?: string;
  hooks?: HooksSettings;
  shell?: ShellSpec;
  paths?: string[]; // conditional
  disableModelInvocation: boolean;
  userInvocable: boolean;
  source: 'userSettings' | 'projectSettings' | 'policySettings' | 'plugin' | 'bundled' | 'mcp';
  loadedFrom: 'skills' | 'commands_DEPRECATED' | 'plugin' | 'managed' | 'bundled' | 'mcp';
  skillRoot?: string; // base dir for asset refs
  contentLength: number;
  isHidden: boolean;
  pluginInfo?: { pluginManifest; repository };
  version?: string;

  // LAZY body loader — produces the messages to inject when invoked
  getPromptForCommand(args: string, ctx: ToolUseContext): Promise<ContentBlockParam[]>;
};
```

The loader's only job is to produce this record cheaply; the heavy work (substitutions, shell execution) runs inside `getPromptForCommand` at invocation time.

---

## 5. Loading pipeline

```
for each configured root:
    for each entry in root:
        if entry is a directory (or symlink to one):
            read <entry>/SKILL.md                      # skip silently if ENOENT
            parseFrontmatter(content) -> {frontmatter, body}
            parsed = parseSkillFrontmatterFields(...)  # normalize all typed fields
            paths  = parseSkillPaths(frontmatter)      # see §7
            skill  = createSkillCommand({ ...parsed, skillName=dir, markdownContent=body,
                                          baseDir=<entry>, source, loadedFrom: 'skills', paths })
            emit { skill, filePath: SKILL.md }
```

After collecting from all roots:

1. **Dedup by canonical path.** Call `realpath` on every `SKILL.md` path (in parallel, since realpath calls are independent). Group by result; first-seen wins. This handles symlinks and parent-dir overlap. Use realpath, **not** inode — some filesystems (NFS, ExFAT, some containers) return unreliable inodes.
2. **Separate conditional from unconditional.** Skills with a non-empty, non-match-all `paths:` frontmatter are "conditional" → stored in a side map; not advertised until a touched file matches (§7).
3. **Cache the result.** The walk is expensive; memoize by cwd. Invalidate on plugin reload, skill file edit, or explicit `/clear`-style reset.

Loading is parallelized per-root (independent I/O); dedup runs after all results collected.

---

## 6. Invocation paths

### 6a. Slash command (user types `/name arg1 arg2`)

User input routed to a slash-command processor which:

1. Looks up the skill by name in the registry.
2. Runs `getPromptForCommand(args, ctx)` → returns content blocks.
3. Wraps them in a user message tagged with a `<command-name>` marker so the turn-0 listing knows not to re-advertise the skill this turn.
4. Applies `allowedTools`, `model`, `effort`, and `hooks` overrides to the context of that turn.

### 6b. Model invocation via the `Skill` tool

A tool named `Skill` with input schema:

```json
{
  "skill": "commit",
  "args": "-m 'Fix bug'" // optional
}
```

`description`: "Execute a skill within the main conversation".

Tool prompt (the tool's own `prompt` field — what the model sees as help):

```
When users ask you to perform tasks, check if any of the available skills match.
When users reference a "slash command" or "/<something>", they are referring to a skill. Use this tool to invoke it.
- Available skills are listed in system-reminder messages.
- BLOCKING REQUIREMENT: invoke the Skill tool BEFORE any other response when a skill matches.
- NEVER mention a skill without actually calling this tool.
- Do not use for built-in CLI commands (/help, /clear, etc.).
- If you see <command-name> in the current turn, the skill is already loaded — follow its instructions directly.
```

`validateInput`:

- Trim input, strip optional leading `/`.
- Reject empty.
- Reject unknown skill.
- Reject `disableModelInvocation === true`.
- Reject non-prompt commands.

`checkPermissions`:

- Match against allow/deny rules. Rules support exact (`commit`) and prefix (`review:*`).
- Auto-allow if the skill has only "safe" properties (see §11 allowlist).
- Otherwise `ask` the user, suggesting two rules to add on approval: exact + prefix.

`call`:

- `context === 'fork'` → run in isolated sub-agent via `runAgent` (fresh budget, fresh tool set; result text returned to parent).
- Otherwise **inline**:
  - Call `processPromptSlashCommand(name, args, registry, ctx)` — same path as slash-command invocation; produces `messages` to inject.
  - Return `{ data, newMessages, contextModifier }`. `newMessages` are tagged with the tool-use id so they stay transient until the tool resolves. `contextModifier` merges `allowedTools`, `model`, `effort` into the current turn's context.

Record invocation for the ranking/usage tracker. Return early if the skill is a "remote canonical" one (see §12).

---

## 7. Conditional skills (`paths:` frontmatter)

A skill with `paths:` is not shown in the turn-0 listing until a file operation (Read/Write/Edit/Grep/etc.) touches a matching path. Pattern syntax is **gitignore-style**, implemented via the `ignore` library in JS; use `pathspec` in Python or `gitignore-go` equivalents.

Normalization:

- Strip trailing `/**` — `ignore` treats `path` as both the path and everything under it.
- Drop patterns that evaluate to pure match-all (`**`) — treat as "no paths" and promote to unconditional.

Matching:

- On file-tool use, compute each path relative to cwd; skip if `..`-prefixed or absolute (cross-drive on Windows).
- For each conditional skill, ask the matcher `ignores(relPath)` — first match activates.
- Activated skills move from `conditionalSkills` map into `dynamicSkills` map; record in `activatedConditionalSkillNames` so they survive cache clears.
- Emit a "skills changed" signal so the turn-0 listing can re-announce the new skill next attachment build.

---

## 8. Dynamic skill discovery

Alongside conditional activation, the system also discovers **new skill directories** that appear _below_ cwd as the agent operates. Useful when a monorepo has nested `.claude/skills/` per package.

On every file-tool use:

```
for each touched file:
  currentDir = dirname(file)
  while currentDir is strictly below cwd:
      check <currentDir>/.claude/skills/
      if exists and not gitignored and not already checked:
          add to new-dirs
      currentDir = dirname(currentDir)
```

Memoize "already checked" (hit or miss) to avoid a stat per operation. Respect `.gitignore` (via `git check-ignore`) so `node_modules/.claude/skills/` doesn't auto-load. Gitignore check fails open outside a git repo — the user-trust dialog is the real boundary.

Sort discovered dirs deepest-first and feed through the normal loader. Deepest-first means nested overrides parent when names collide.

---

## 9. Substitutions in the body

Order, applied inside `getPromptForCommand`:

1. Prepend `Base directory for this skill: <baseDir>\n\n` when `baseDir` is set (disk + bundled-with-files + MCP-with-cache all get this).
2. Substitute positional args (`$1`..`$N`, `$ARGUMENTS`) and named args (from `arguments:`).
3. Substitute `${CLAUDE_SKILL_DIR}` with `baseDir`. Normalize backslashes to forward slashes on Windows so shells don't treat them as escapes.
4. Substitute `${CLAUDE_SESSION_ID}`.
5. Execute inline shell (`!`cmd``and fenced`!`blocks) **unless the skill is MCP-sourced** (remote, untrusted). Respect the`shell:`frontmatter constraints and the skill's`allowedTools`— the executor temporarily extends the`alwaysAllowRules.command` list for the duration of substitution.

Result is a single text content block (or array including images, if the body embeds any).

---

## 10. Turn-0 listing (how the model discovers skills)

At the start of each turn, a system attachment is built announcing newly-available skills. Pseudocode:

```
commands = local-commands(cwd) ++ mcp-skills     # dedup by name
sent = already-sent-names(agentId)               # per-agent map, main thread = ""
new = commands where name not in sent
if new is empty: return []
content = formatCommandsWithinBudget(new, contextWindowTokens)
mark new as sent
return [{ type: 'skill_listing', content, skillCount: new.length, isInitial: sent was empty }]
```

That attachment renders into the conversation as a user-meta system-reminder:

```
The following skills are available for use with the Skill tool:

- commit: Create a commit from the current diff.
- review-pr: Review a pull request (args: <pr-number>)
- pdf: Read or write PDFs
...
```

Rules:

- Per-agent (subagents get their own turn-0 copy; otherwise the main thread's "sent" set hides skills from children).
- On compact, the listing is NOT re-injected (post-compact reinject ≈ pure cache_creation with no hit rate benefit). Reset the sent-set on `/clear` or plugin reload so the listing refreshes naturally.
- On `--resume`, suppress exactly one listing — transcript already has one. Trade-off: cross-session skill deltas won't auto-announce.
- Skip entirely for subagents that don't have the Skill tool in their tool set.

### Budget formatting

Target ≈ **1% of the context window in chars** (chars ≈ tokens × 4). Fallback when context size unknown: 8000 chars.

```
if full-listing fits: emit as-is
else:
    bundled skills always keep full descriptions
    rest: compute maxDescLen = (budget - bundled_chars - name_overhead) / rest_count
    if maxDescLen < MIN_DESC_LENGTH (~20): emit names-only for non-bundled, full for bundled
    else: truncate each non-bundled description to maxDescLen
```

Per-entry hard cap of 250 chars regardless of budget — discovery only; the Skill tool loads full content on invoke.

Each entry line: `- <name>: <description> - <whenToUse>` (truncated). `whenToUse` is appended to `description` with `-` separator.

---

## 11. Bundled skills (compiled in)

Shape:

```ts
type BundledSkillDefinition = {
  name: string;
  description: string;
  aliases?: string[];
  whenToUse?: string;
  argumentHint?: string;
  allowedTools?: string[];
  model?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  isEnabled?: () => boolean; // runtime visibility gate (feature flags)
  hooks?: HooksSettings;
  context?: 'inline' | 'fork';
  agent?: string;
  files?: Record<string, string>; // optional side-files extracted on first use
  getPromptForCommand(args, ctx): Promise<ContentBlockParam[]>;
};
```

Registration is imperative, called once at startup:

```ts
registerBundledSkill({
  name: 'simplify',
  description: '...',
  getPromptForCommand: async () => [{ type: 'text', text: SIMPLIFY_PROMPT }],
});
```

An `initBundledSkills()` init function fans out to per-skill `registerXxxSkill()` functions, some behind `feature(...)` flags. Keep this imperative + explicit — it's the dependency-injection boundary for the binary.

### Extracting side-files

If `files` is non-empty, allocate a per-process extraction dir (`<bundled-root>/<skill-name>`, where `<bundled-root>` contains a per-process nonce). On first invocation:

1. Memoize the extraction _promise_ (not result), so concurrent callers await one write instead of racing.
2. For each (rel-path, content), create the parent dir with mode `0o700`, then write via `open(..., O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW, 0o600)`. On Windows use `'wx'` flag string.
3. Reject any `rel-path` that is absolute or contains `..` — skill-dir escape.
4. Do **not** unlink+retry on EEXIST (unlink follows intermediate symlinks). The per-process nonce is the primary defense.
5. Prepend `Base directory for this skill: <extractedDir>\n\n` to the model output so it can Read/Grep the files. On failure, return blocks unmodified — skill continues to work, just without the base-dir prefix.

---

## 12. Remote / MCP skills

**MCP skills** are discovered via MCP server `prompts/list` and wrapped as `Command` records with `source='mcp'`, `loadedFrom='mcp'`. Key difference: body comes from the MCP server, so **never execute inline shell commands** from it — strip the `!`…``expansion step.`${CLAUDE_SKILL_DIR}` is meaningless here too.

**Remote canonical skills** (optional, advanced): names prefixed with a sentinel (e.g. `_canonical_<slug>`). The Skill tool intercepts them in `validateInput`/`call` _before_ local registry lookup, fetches the `SKILL.md` from a blob store (GCS/S3/HTTPS) with a local cache, then wraps the body directly into a user-meta message (no slash-command expansion needed — they're declarative Markdown). Register via `addInvokedSkill(name, cachedPath, finalContent, agentId)` so they survive compaction.

For port: treat remote as a specialization of MCP — untrusted body, fetched lazily, cached on disk, registered in session state at invocation.

---

## 13. Compaction / conversation recovery

Skills that were invoked mid-conversation need to survive context compaction:

- Keep a session-scoped `invokedSkills` map: `(skillName, agentId) → { path, finalContent }`.
- After compaction, re-inject the finalContent (post-substitution) so the post-compact model still has the skill's instructions.
- `addInvokedSkill` is called from inside the slash-command processor, and also directly from remote-skill invocation (since remote skips that processor).

On `--resume`, if a `skill_listing` attachment is already in the transcript, suppress the next one (`suppressNextSkillListing`).

---

## 14. Permissions model

The Skill tool is itself permissioned. Rules live alongside other tool rules (e.g. `Bash`, `Read`). Rule grammar:

```
toolName: "Skill"
ruleContent: "commit"              # exact match
ruleContent: "review:*"            # prefix match (review, review-pr, review-xyz)
```

Decision order inside `checkPermissions`:

1. Deny rules first.
2. Auto-allow if the skill object has only "safe" properties. The safe set is an **allowlist** of known fields (`name`, `description`, `allowedTools`, `model`, `effort`, `agent`, `hooks`, etc.); any unknown field with a meaningful value forces `ask`. This ensures new fields default to requiring permission.
3. Allow rules next.
4. Fallback: `ask`, with two suggested rules to add (`name` + `name:*`).

Skills can additionally declare `allowed-tools` in frontmatter — during this skill's turn, those tools' `alwaysAllowRules.command` entries are extended so the body can `!`shell``-expand and call tools without reprompting.

---

## 15. Fork execution

If `context: fork`, run the skill in a sub-agent:

1. Build a fork context: `{ baseAgent, promptMessages, skillContent, modifiedGetAppState } = prepareForkedCommandContext(command, args, ctx)`.
2. Merge skill's `effort` into the agent definition.
3. Drive `runAgent(...)`, collecting the stream of messages; report progress via a `skill_progress` callback for tool-use blocks.
4. Extract the final result text; return `{ status: 'forked', agentId, result }`.
5. On completion (finally), call `clearInvokedSkillsForAgent(agentId)` to release memory.

Forked skills are great for read-only research or bounded task; inline is for "the agent should just follow these steps now."

---

## 16. UI surfacing (optional but expected)

- `/<name>` auto-completes from the registry.
- A menu (`/skills` or similar) groups by source (managed / user / project / plugin / bundled / mcp), shows description and path.
- Admin can "lock" skills to plugin-only via policy (`isRestrictedToPluginOnly('skills')`) — project/user/legacy loaders no-op.
- Hidden skills (`userInvocable: false`) don't appear in slash-command completion but are still callable by the model via Skill tool.

---

## 17. Legacy `commands/` loader (optional)

Some codebases migrated from a `.claude/commands/` layout where:

- `<dir>/<name>.md` is a single-file command.
- `<dir>/<subdir>/SKILL.md` becomes a skill named from the subdir (namespaced by folders: `<subdir1>:<subdir2>:SKILL_dir_name`).

Implement only if you need backwards-compat; new work should use `skills/`.

---

## 18. Signals / cache invalidation

Hook these events:

- **Plugin reload** → clear skill caches, clear sent-skill set (listing re-announces).
- **SKILL.md edit** (file-watcher) → same.
- **`/clear`** → clear sent-skill set only (keep loaded skills).
- **New conditional skill activated** OR **dynamic skill dir loaded** → emit a `skillsLoaded` signal; consumers (e.g. the turn-0 listing builder) subscribe and rebuild next attachment.
- Wrap signal listeners in a try/catch so a throwing subscriber can't abort the emit loop.

In the reference impl this is a tiny `createSignal()` utility. Any pub-sub works.

---

## 19. Telemetry (optional)

Events worth logging, if you have an analytics pipe:

- `skill_tool_invocation`: name, source, loadedFrom, kind, execution_context (inline/fork/remote), invocation_trigger (claude-proactive / nested-skill / user-slash), was_discovered, query_depth, parent_agent_id, plugin_name+repo if plugin-sourced.
- `dynamic_skills_changed`: source (file_operation / conditional_paths), before/after counts, added count, directory count.
- `skill_descriptions_truncated`: budget overflow diagnostics.

---

## 20. Implementation checklist

Minimum viable skill system:

- [ ] Frontmatter parser (YAML) with the fields in §3.
- [ ] Disk loader that walks configured roots, parses `<dir>/SKILL.md`, produces normalized records.
- [ ] Canonical-path dedup across roots (resolve symlinks).
- [ ] Registry API: `getSkills(cwd)`, `findSkill(name)`, `clearCaches()`.
- [ ] `Skill` tool with `validateInput`, `checkPermissions`, `call` (inline path).
- [ ] `getPromptForCommand` implementing substitutions in §9.
- [ ] Turn-0 listing attachment with budget formatting (§10).
- [ ] Per-agent "already sent" tracking.
- [ ] Slash-command processor that produces the same messages as the Skill tool.

Recommended extensions (in order of value):

- [ ] Bundled-skill registry + imperative `registerBundledSkill`.
- [ ] Conditional skills via `paths:` frontmatter + file-op hook to activate.
- [ ] Dynamic skill discovery (walk up from file-op paths).
- [ ] Fork execution (`context: fork`).
- [ ] MCP skill adapter.
- [ ] Post-compaction survival via invokedSkills state.
- [ ] Safe-properties auto-allow in checkPermissions.
- [ ] Bundled side-file extraction with O_EXCL+O_NOFOLLOW.
- [ ] Remote canonical skills with blob-store fetch + cache.

---

## 21. Gotchas

- **Dedup by path, not by name.** Same file loaded from overlapping parent dirs must merge; two different skills with the same name must _not_ silently collide. First-wins by resolved path.
- **Don't re-inject the listing post-compact.** ~4K cache_creation tokens, zero benefit.
- **Never execute shell in MCP-sourced bodies.** Remote/untrusted.
- **Reject `..` in bundled `files:` keys.** Skill-dir escape.
- **Cross-drive `relative()` on Windows** can return an absolute path. Guard the conditional-skill matcher against that.
- **`ignore()` library throws** on empty strings, absolute paths, and `..`-prefixed paths. Filter before calling.
- **Concurrent bundled extraction races.** Memoize the promise, not the result.
- **Memoize the discovery-dir "already checked" set** — otherwise every file op re-stats nonexistent dirs.
- **`inherit` model is not a model.** Treat as `undefined` — don't pass through to the model resolver.
- **Gitignore check for dynamic discovery must fail open** (e.g. not in a git repo) so the feature still works outside repos; the user-trust dialog is the real safety boundary.
- **`sentSkillNames` is per-agent.** Without per-agent scoping, the main thread populates it and every subagent starts with an empty listing.
- **`${CLAUDE_SKILL_DIR}` on Windows.** Normalize `\` → `/`, otherwise shell expansion eats backslashes.
- **`contextModifier` in inline call.** Chain via `previousGetAppState`, not `ctx.getAppState` from closure — otherwise later modifiers overwrite earlier ones.
- **Carry `[1m]` (1M context) suffix** when applying skill model override onto the main-loop model; else a skill with `model: opus` on a `opus[1m]` session drops to 200K and trips autocompact.
