# Write, Edit, NotebookEdit — Implementation Guide

This document specifies three tools an AI coding agent uses to *modify* the local filesystem: **Write** (full-file create/overwrite), **Edit** (exact-string replacement in an existing file), and **NotebookEdit** (cell-level edits to `.ipynb` files). Companion to `read.md`.

It assumes the reader has already implemented `Read`, `Glob`, and `Grep` per `read.md`. Where the same machinery applies, this doc references that one rather than restating it. Read §0 of `read.md` first — `expandPath`, the binary-extension table, the UNC guard, the `ToolPermissionContext` shape, and the `tool definition` skeleton are all reused here.

The three write tools share a strict pre-flight invariant:

> **Read-before-write.** A file the agent has not previously `Read` (or one mutated since the last `Read`) cannot be modified. The validation step rejects with an explicit message instructing the agent to `Read` first. This is enforced via the per-session `readFileState` map populated by Read.

Implement in this order: shared infra (§0) → Write (§1) → Edit (§2) → NotebookEdit (§3). Validate against the checklist in §6.

---

## 0. Cross-cutting infrastructure

Build these helpers first. They are dependencies for all three tools.

### 0.1 `readFileState` (the staleness oracle)

The same map populated by `Read`. Keyed by post-`expandPath` absolute file path:

```ts
type ReadFileEntry = {
  content:    string                  // CRLF-normalized
  timestamp:  number                  // Math.floor(stats.mtimeMs)
  offset?:    number                  // 1-indexed; undefined = full read (came from Edit/Write)
  limit?:     number                  // line count; undefined = full read
  isPartialView?: boolean             // true if the entry only represents part of the file
}
```

Two consequences for this doc:

1. **Read-before-write check.** Before any mutation, look up the file. Missing entry → reject. `isPartialView: true` → reject (the agent only saw a slice).
2. **Mtime check.** On disk now `stats.mtimeMs > entry.timestamp` → file was touched between Read and Write. Default action: reject and force a re-Read. **Windows escape hatch:** cloud sync / antivirus changes mtime without changing bytes; for entries whose `offset === undefined && limit === undefined` (the full-read case), if the on-disk content equals `entry.content` byte-for-byte, accept and proceed.

After every successful write, **update the entry**:

```ts
readFileState.set(absPath, {
  content: <new content>,
  timestamp: getFileModificationTime(absPath),  // freshly stat'd
  offset: undefined,
  limit: undefined,
})
```

This is what makes the next mutation see the freshest mtime — without it, two consecutive Edit calls would trigger the staleness alarm on the second.

### 0.2 Encoding & line-ending detection

Implement these one-pass helpers. Edit and Write share them; redoing the work on every call doubles syscall cost.

**`detectEncodingForResolvedPath(path) → BufferEncoding`**

1. Open path, read first 4096 bytes.
2. Empty file → `'utf8'` (NOT `'ascii'` — writing emoji/CJK to an empty file with ascii encoding corrupts).
3. `0xFF 0xFE` BOM → `'utf16le'`.
4. `0xEF 0xBB 0xBF` BOM → `'utf8'`.
5. Otherwise `'utf8'` (utf8 is a strict superset of ascii, no need to be cleverer).

**`detectLineEndingsForString(content) → 'LF' | 'CRLF'`**

```ts
let crlf = 0, lf = 0
for (let i = 0; i < content.length; i++) {
  if (content[i] === '\n') {
    if (i > 0 && content[i-1] === '\r') crlf++; else lf++
  }
}
return crlf > lfCount ? 'CRLF' : 'LF'
```

Empty file or no newlines → `'LF'`. Mixed file → majority wins.

**`readFileSyncWithMetadata(path) → {content, encoding, lineEndings}`**

One filesystem pass:

```ts
const { resolvedPath, isSymlink } = safeResolvePath(path)   // resolves symlinks, validates
const encoding = detectEncodingForResolvedPath(resolvedPath)
const raw      = fs.readFileSync(resolvedPath, { encoding })
// Detect endings from the raw HEAD (≤4096 chars) before normalization.
const lineEndings = detectLineEndingsForString(raw.slice(0, 4096))
return {
  content: raw.replaceAll('\r\n', '\n'),                    // <-- always normalize CRLF→LF
  encoding,
  lineEndings,
}
```

Always return CRLF-normalized content. The diff/match math runs on `\n`-only strings; the original line-ending preference is preserved separately so `writeTextContent` can reapply it.

### 0.3 `writeTextContent(path, content, encoding, endings)`

The atomic counterpart. Single sync write:

```ts
function writeTextContent(filePath, content, encoding, endings) {
  let toWrite = content
  if (endings === 'CRLF') {
    // Defensive: caller may have passed content that already contains CRLF.
    // Normalize first to avoid \r\r\n.
    toWrite = content.replaceAll('\r\n', '\n').split('\n').join('\r\n')
  }
  writeFileSyncAndFlush(filePath, toWrite, { encoding })
}
```

Use a sync write that flushes (`fsync`) before returning. Atomicity matters here: a mid-write power loss shouldn't leave a half-written file the next Read would index as canonical.

**Important asymmetry:** `Write` and `Edit` treat line endings differently — see §1 and §2. Write *ignores* the file's existing line-ending convention and writes exactly the bytes the model sent (LF). Edit *preserves* the file's existing convention. The reasoning is that `Write` is a full content replacement that the model wrote with explicit `\n`s and meant them; previously the tool sampled the repo to guess line endings and silently corrupted bash scripts on Linux when overwriting CRLF files. Edit operates on the file's own bytes and should round-trip them.

### 0.4 `getFileModificationTime(path) → number`

```ts
return Math.floor(fs.statSync(path).mtimeMs)
```

`Math.floor` defends against sub-millisecond precision drift from IDE file watchers that touch files without changing content.

There is also an `async` variant (`fs.stat`) for code paths that can't tolerate sync I/O. The harness's per-turn changed-files scan uses async to avoid the slow-operation indicator on network mounts.

### 0.5 Permission model

For all three tools:

- `checkWritePermissionForTool(tool, input, ctx) → 'allow' | 'ask' | 'deny'` — same shape as `checkReadPermissionForTool` but consults `edit.allow` / `edit.deny` rules.
- `matchingRuleForInput(absPath, ctx, 'edit', 'deny') → rule | null` — pure-path deny check used in `validateInput`.
- All three are **NOT** `isReadOnly` and **NOT** `isConcurrencySafe` (they mutate disk and the harness should serialize them per file).

### 0.6 The `getPatchForEdit` / `getPatchForEdits` helpers

Both Write (when overwriting) and Edit produce structured diff hunks for UI rendering and analytics. Use the `diff` library's `structuredPatch` (or equivalent) and shape each hunk as:

```ts
type Hunk = {
  oldStart: number   // 1-indexed
  oldLines: number
  newStart: number
  newLines: number
  lines:    string[] // Each line prefixed with ' ', '-', or '+'
}
```

A wrapper:

```ts
function getPatchFromContents({filePath, oldContent, newContent}): Hunk[] {
  return structuredPatch(filePath, filePath,
    convertLeadingTabsToSpaces(oldContent),
    convertLeadingTabsToSpaces(newContent),
    undefined, undefined,
    { context: 4 /* lines */, timeout: DIFF_TIMEOUT_MS /* e.g. 1000 */ }
  ).hunks
}
```

`convertLeadingTabsToSpaces`: leading tabs → 2 spaces, line-by-line. Display only; the actual file write retains tabs.

```ts
function convertLeadingTabsToSpaces(content) {
  if (!content.includes('\t')) return content    // fast path — most files don't tab-indent
  return content.replace(/^\t+/gm, m => '  '.repeat(m.length))
}
```

The display-patch from `getPatchForEdit` is *for UI only*. Don't write it back to disk.

### 0.7 File history (optional but recommended)

Maintain an in-memory history stack of pre-edit file contents keyed by path + parent message UUID. Lets the user undo/restore. Two functions:

- `fileHistoryEnabled(): boolean` — global toggle (env var or feature flag).
- `fileHistoryTrackEdit(state, absPath, parentMessageUuid)` — captures the pre-edit content. **Idempotent v1**: keys backups by content hash, so calling it multiple times is safe.

Call before every mutation, *before* the staleness check. If the staleness check fails, you'll have an unused backup but no corrupt state.

### 0.8 LSP / IDE notifications

After any successful write, fire-and-forget notify integrations:

- Clear delivered LSP diagnostics for `file://${absPath}`.
- LSP `didChange(absPath, newContent)` — content changed in memory.
- LSP `didSave(absPath)` — content flushed to disk (this is what triggers the TypeScript server to recompute diagnostics).
- VSCode SDK MCP: `notifyVscodeFileUpdated(absPath, oldContent, newContent)` — drives the diff view in the IDE panel.

Failures here must not fail the tool call. Log and move on.

### 0.9 Diagnostic tracker

`diagnosticTracker.beforeFileEdited(absPath)` — call **before** any mutation. Snapshots the pre-edit diagnostic count so the harness can later report "this edit introduced 3 new errors". Independent of the LSP notifications above.

### 0.10 Skill discovery side-effect

Same hook used by Read:

```ts
const newSkillDirs = await discoverSkillDirsForPaths([absPath], cwd)
for (const d of newSkillDirs) ctx.dynamicSkillDirTriggers?.add(d)
addSkillDirectories(newSkillDirs).catch(() => {})              // background
activateConditionalSkillsForPaths([absPath], cwd)
```

Skip if `process.env.CLAUDE_CODE_SIMPLE` is truthy (no skills available in simple mode).

### 0.11 Atomicity discipline

The Write/Edit `call()` follow this invariant:

> Every async operation must happen **before** the read-modify-write critical section. Once you `readFileSyncWithMetadata`, do not `await` again until you've called `writeTextContent`. A yield between the staleness check and the write lets a concurrent edit interleave.

Operations safe to do *before* the critical section: `mkdir(dirname(path))`, history backup, skill discovery, `diagnosticTracker.beforeFileEdited`. Operations safe to do *after* the write: LSP notifications (fire-and-forget), VSCode notification, telemetry events, git diff fetch.

`mkdir(dirname)` specifically must run before the write — otherwise an ENOENT-on-write would fire a spurious atomic-write error event before the parent-missing error propagates back.

### 0.12 Quote normalization (curly ↔ straight)

Some models cannot reliably emit curly quotes. To make Edit work against files containing them, both inputs and the file content are normalized before matching:

```ts
const LEFT_DOUBLE  = '“'   // “
const RIGHT_DOUBLE = '”'   // ”
const LEFT_SINGLE  = '‘'   // ‘
const RIGHT_SINGLE = '’'   // ’

function normalizeQuotes(s) {
  return s
    .replaceAll(LEFT_DOUBLE,  '"').replaceAll(RIGHT_DOUBLE, '"')
    .replaceAll(LEFT_SINGLE,  "'").replaceAll(RIGHT_SINGLE, "'")
}

function findActualString(fileContent, searchString) {
  if (fileContent.includes(searchString)) return searchString  // exact match wins
  const idx = normalizeQuotes(fileContent).indexOf(normalizeQuotes(searchString))
  if (idx === -1) return null
  // Slice the original (non-normalized) file at the matched offset, length = searchString.length
  return fileContent.substring(idx, idx + searchString.length)
}
```

If the match required normalization, also rebuild `new_string` with the file's curly-quote convention before writing. See `preserveQuoteStyle` in §2.6.

### 0.13 Safety filters

Two checks the model can't bypass:

1. **Team-memory secret guard.** `checkTeamMemSecrets(absPath, content)` — when writing/editing files inside the team-memory tree (e.g. `~/.claude/team-memory/...`), scan `content` for credential patterns (API keys, tokens, etc.). Returns an error string if a secret is detected; otherwise `null`. If non-null, reject with the message and `errorCode: 0`.
2. **Settings-file extra validation.** When `Edit`-ing `~/.claude/settings.json` or per-project `.claude/settings.json`, run additional schema checks. If the simulated post-edit content violates the schema, reject with a structured message (so the model doesn't write a `settings.json` that breaks the harness on next start). Implementation: simulate the edit (apply replace/replaceAll), then call `validateInputForSettingsFileEdit(absPath, originalFile, () => simulatedContent)`.

---

## 1. Write tool

### 1.1 Name, prompt, output cap

- **Name:** `Write`
- **maxResultSizeChars:** `100_000`
- **strict:** `true`
- **searchHint:** `"create or overwrite files"`

Description (rendered into the system prompt):

```
Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's
  contents. This tool will fail if you did not read the file first.
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use
  this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested
  by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files
  unless asked.
```

### 1.2 Input schema

```ts
{
  file_path: string,    // required, absolute
  content:   string,    // required, the full new contents
}
```

`strict: true`: reject any extra keys.

### 1.3 Output schema

```ts
{
  type:          'create' | 'update',         // create = file did not exist before
  filePath:      string,                       // the input path (preserve user's spelling)
  content:       string,                       // exactly what was written
  structuredPatch: Hunk[],                     // empty array on 'create'
  originalFile:  string | null,                // pre-write content; null on 'create'
  gitDiff?:      ToolUseDiff,                  // optional; only when remote-mode flag is on
}
```

`gitDiff` is only populated when `process.env.CLAUDE_CODE_REMOTE` is truthy and a feature flag (`tengu_quartz_lantern`) is on. It runs `git diff` against HEAD for this single file post-write. Skip the implementation entirely if you don't run remote.

### 1.4 validateInput

In order:

1. `expandPath(file_path)`.
2. **Team-memory secret guard.** §0.13. Returns `errorCode: 0` if violated.
3. **Deny-rule check.** `matchingRuleForInput(absPath, ctx, 'edit', 'deny')` → `errorCode: 1`, message `"File is in a directory that is denied by your permission settings."`
4. **UNC short-circuit.** If `absPath` starts with `\\` or `//`, return `{result: true}` and let the executor handle it. **Never** stat a UNC path during validation.
5. `stat(absPath)`:
   - ENOENT → `{result: true}`. New-file write is always allowed (no Read needed).
   - Other error → re-throw.
   - Success: continue to staleness check.
6. **Read-before-write.** Look up `readFileState.get(absPath)`. If missing or `isPartialView` → `errorCode: 2`, message `"File has not been read yet. Read it first before writing to it."`
7. **Mtime staleness.** `Math.floor(stats.mtimeMs) > entry.timestamp` → `errorCode: 3`, message `"File has been modified since read, either by the user or by a linter. Read it again before attempting to write it."`

   (Windows-style content-fallback comparison is **not** done here in `validateInput` — it's deferred to the executor's critical section, which has `meta.content` in hand. Doing the byte compare here would require an extra read.)

### 1.5 Executor (`call`)

Sequence — note where awaits are allowed and where they are forbidden:

```ts
async call({file_path, content}, ctx, _, parentMessage) {
  const absPath = expandPath(file_path)
  const dir     = dirname(absPath)

  // [pre-critical: async OK]
  await skillDiscovery(absPath, ctx)
  await diagnosticTracker.beforeFileEdited(absPath)
  await fs.mkdir(dir, { recursive: true })
  if (fileHistoryEnabled())
    await fileHistoryTrackEdit(ctx.updateFileHistoryState, absPath, parentMessage.uuid)

  // ----- CRITICAL SECTION: no awaits until writeTextContent has run -----
  let meta
  try { meta = readFileSyncWithMetadata(absPath) }
  catch (e) { if (isENOENT(e)) meta = null; else throw e }

  if (meta !== null) {
    const lastWriteTime = getFileModificationTime(absPath)
    const lastRead      = ctx.readFileState.get(absPath)
    if (!lastRead || lastWriteTime > lastRead.timestamp) {
      const isFullRead = lastRead && lastRead.offset === undefined && lastRead.limit === undefined
      // Windows mtime-without-content-change escape hatch.
      // meta.content is CRLF-normalized; lastRead.content is also normalized.
      if (!isFullRead || meta.content !== lastRead.content) {
        throw new Error(FILE_UNEXPECTEDLY_MODIFIED_ERROR)
      }
    }
  }

  const enc        = meta?.encoding ?? 'utf8'
  const oldContent = meta?.content  ?? null

  // KEY DECISION: Always write LF. The model sent explicit \n in content and meant them.
  // Do NOT preserve the file's existing CRLF. Previously this preserved or sampled — it
  // silently corrupted bash scripts (\r on Linux) and mishandled binaries-poisoned repos.
  writeTextContent(absPath, content, enc, 'LF')
  // ----- END CRITICAL SECTION -----

  // [post-write: async OK, fire-and-forget]
  notifyLsp(absPath, content)
  notifyVscodeFileUpdated(absPath, oldContent, content)

  // Update the read-state entry so the next Edit/Write doesn't trip the staleness check.
  ctx.readFileState.set(absPath, {
    content,
    timestamp: getFileModificationTime(absPath),
    offset:    undefined,
    limit:     undefined,
  })

  // Telemetry
  if (absPath.endsWith(`${sep}CLAUDE.md`)) logEvent('tengu_write_claudemd', {})
  countLinesChanged(oldContent ? patch : [], oldContent ? undefined : content)
  logFileOperation({operation: 'write', tool: 'FileWriteTool', filePath: absPath,
                    type: oldContent ? 'update' : 'create'})

  // Optional: gitDiff fetch
  let gitDiff = process.env.CLAUDE_CODE_REMOTE ? await fetchSingleFileGitDiff(absPath) : undefined

  if (oldContent) {
    const patch = getPatchForDisplay({
      filePath: file_path, fileContents: oldContent,
      edits: [{old_string: oldContent, new_string: content, replace_all: false}],
    })
    return { data: { type: 'update', filePath: file_path, content,
                     structuredPatch: patch, originalFile: oldContent, ...(gitDiff && {gitDiff}) }}
  }
  return { data: { type: 'create', filePath: file_path, content,
                   structuredPatch: [], originalFile: null, ...(gitDiff && {gitDiff}) }}
}
```

### 1.6 Render

Tiny — the structured diff travels in `data` for the UI; the model only needs confirmation:

```ts
mapToolResultToToolResultBlockParam({filePath, type}, id) {
  return {
    tool_use_id: id, type: 'tool_result',
    content: type === 'create'
      ? `File created successfully at: ${filePath}`
      : `The file ${filePath} has been updated successfully.`,
  }
}

extractSearchText() { return '' }   // see comment in source: heuristic would index
                                    // raw `content` even in update mode where the UI
                                    // shows a diff, not the content. Phantom; skip.
```

---

## 2. Edit tool

### 2.1 Name, prompt, output cap

- **Name:** `Edit`
- **maxResultSizeChars:** `100_000`
- **strict:** `true`
- **searchHint:** `"modify file contents in place"`

Description:

```
Performs exact string replacements in files.

Usage:
- You must use your `Read` tool at least once in the conversation before editing. This
  tool will error if you attempt an edit without reading the file.
- When editing text from Read tool output, ensure you preserve the exact indentation
  (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix
  format is: spaces + line number + arrow (or, in compact mode: line number + tab).
  Everything after that is the actual file content to match. Never include any part
  of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless
  explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files
  unless asked.
- The edit will FAIL if `old_string` is not unique in the file. Either provide a
  larger string with more surrounding context to make it unique or use `replace_all`
  to change every instance of `old_string`.
- Use `replace_all` for replacing and renaming strings across the file. This parameter
  is useful if you want to rename a variable for instance.
```

The "line number prefix" wording must match the format your Read renderer actually uses (compact `N\t` vs. padded `   N→`). See `read.md` §1.15.

### 2.2 Input schema

```ts
{
  file_path:    string,                  // required, absolute
  old_string:   string,                  // text to replace
  new_string:   string,                  // text to replace it with (must differ)
  replace_all?: boolean,                 // default false; replace every occurrence
}
```

### 2.3 Output schema

```ts
{
  filePath:        string,
  oldString:       string,            // the actual matched string (post-quote-normalization)
  newString:       string,            // as supplied by model
  originalFile:    string,            // pre-edit content (CRLF-normalized)
  structuredPatch: Hunk[],
  userModified:    boolean,           // true if the user edited the proposed change before accepting
  replaceAll:      boolean,
  gitDiff?:        ToolUseDiff,
}
```

### 2.4 Constants

```ts
const MAX_EDIT_FILE_SIZE = 1024 * 1024 * 1024    // 1 GiB stat-bytes cap
const FILE_UNEXPECTEDLY_MODIFIED_ERROR =
  'File has been unexpectedly modified. Read it again before attempting to write it.'
```

The 1 GiB limit defends against OOM. V8/Bun's max string length is ~2^30 chars (~1 GB for ASCII), so anything bigger can't even be loaded into memory as a string. Multi-byte UTF-8 files can exceed this in stat-bytes per character, but 1 GiB is a safe byte-level guard.

### 2.5 validateInput

Steps in order — each step before §2.5.6 must remain I/O-free or do at most one stat:

1. `expandPath(file_path)`.
2. **Team-memory secret guard** on `new_string`. §0.13. → `errorCode: 0`.
3. **No-op rejection.** If `old_string === new_string`:

   ```
   No changes to make: old_string and new_string are exactly the same.
   ```

   Behavior `'ask'`, `errorCode: 1`. ("Behavior `'ask'`" tells the harness to surface to the user instead of silently failing.)

4. **Deny rule.** Same as Write. → `errorCode: 2`, behavior `'ask'`.
5. **UNC short-circuit.** Return `{result: true}` immediately; do not stat.
6. **Size cap.** `stat(absPath)`. If `size > MAX_EDIT_FILE_SIZE` → `errorCode: 10`, behavior `'ask'`:

   ```
   File is too large to edit ({sizeFormatted}). Maximum editable file size is 1.00 GB.
   ```

   ENOENT here is fine; fall through.

7. **Read raw bytes** (NOT `detectFileEncoding` — that wastes an I/O on missing files):

   ```ts
   let fileContent: string | null
   try {
     const buf = await fs.readFileBytes(absPath)
     const enc = (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) ? 'utf16le' : 'utf8'
     fileContent = buf.toString(enc).replaceAll('\r\n', '\n')
   } catch (e) {
     if (isENOENT(e)) fileContent = null; else throw e
   }
   ```

8. **File doesn't exist (`fileContent === null`):**
   - `old_string === ''` → new-file creation, `{result: true}`. (The actual create happens in `call()` against an empty buffer.)
   - Otherwise → `errorCode: 4`, behavior `'ask'`:

     ```
     File does not exist. Note: your current working directory is {cwd}.
     Did you mean {suggestion}?
     ```

     Suggestion order: `suggestPathUnderCwd(absPath)` first, then `findSimilarFile(absPath)`.

9. **File exists with `old_string === ''`:**
   - `fileContent.trim() !== ''` → `errorCode: 3`, behavior `'ask'`: `"Cannot create new file - file already exists."`
   - Empty existing file → valid (replacing empty with content), return `{result: true}`.

10. **Notebook redirect.** `absPath.endsWith('.ipynb')` → `errorCode: 5`, behavior `'ask'`:

    ```
    File is a Jupyter Notebook. Use the NotebookEdit to edit this file.
    ```

11. **Read-before-write.** Same as Write but with behavior `'ask'`. → `errorCode: 6`. Include `meta: {isFilePathAbsolute: String(isAbsolute(file_path))}` so the UI can hint about absolute-path errors.

12. **Mtime staleness.** Same as Write, with the Windows full-read content-fallback escape hatch. → `errorCode: 7`, behavior `'ask'`.

13. **Find the actual string** via `findActualString(fileContent, old_string)` (§0.12). If `null`:

    ```
    String to replace not found in file.
    String: {old_string}
    ```

    `errorCode: 8`, behavior `'ask'`, with `meta: {isFilePathAbsolute}`.

14. **Multi-match without `replace_all`:**

    ```ts
    const matches = fileContent.split(actualOldString).length - 1
    if (matches > 1 && !replace_all) reject with errorCode: 9, behavior 'ask':
    ```

    ```
    Found {N} matches of the string to replace, but replace_all is false. To replace
    all occurrences, set replace_all to true. To replace only one occurrence, please
    provide more context to uniquely identify the instance.
    String: {old_string}
    ```

    Include `meta: {isFilePathAbsolute, actualOldString}`.

15. **Settings-file extra validation** (§0.13). If the file is a settings file, simulate the edit and validate. Return its result if non-null.

16. Return `{result: true, meta: {actualOldString}}` so `call` doesn't redo the quote-normalization match.

### 2.6 Executor

```ts
async call(input, ctx, _, parentMessage) {
  const { file_path, old_string, new_string, replace_all = false } = input
  const absPath = expandPath(file_path)

  // [pre-critical] skill discovery, diagnostic snapshot, mkdir, history backup.
  await skillDiscovery(absPath, ctx)                 // skip if CLAUDE_CODE_SIMPLE
  await diagnosticTracker.beforeFileEdited(absPath)
  await fs.mkdir(dirname(absPath), { recursive: true })
  if (fileHistoryEnabled())
    await fileHistoryTrackEdit(ctx.updateFileHistoryState, absPath, parentMessage.uuid)

  // ----- CRITICAL SECTION -----
  // readFileForEdit: same as readFileSyncWithMetadata but returns
  // {content:'', fileExists:false, encoding:'utf8', lineEndings:'LF'} on ENOENT
  // so we can handle the new-file case uniformly.
  const { content: orig, fileExists, encoding, lineEndings } = readFileForEdit(absPath)

  if (fileExists) {
    const lastWrite = getFileModificationTime(absPath)
    const lastRead  = ctx.readFileState.get(absPath)
    if (!lastRead || lastWrite > lastRead.timestamp) {
      const isFullRead = lastRead && lastRead.offset === undefined && lastRead.limit === undefined
      if (!(isFullRead && orig === lastRead.content)) {
        throw new Error(FILE_UNEXPECTEDLY_MODIFIED_ERROR)
      }
    }
  }

  // Re-resolve actual old_string from current bytes (validateInput's may be stale
  // if the Windows escape hatch admitted a content-equal but mtime-changed file).
  const actualOldString = findActualString(orig, old_string) || old_string
  const actualNewString = preserveQuoteStyle(old_string, actualOldString, new_string)

  const { patch, updatedFile } = getPatchForEdit({
    filePath: absPath, fileContents: orig,
    oldString: actualOldString, newString: actualNewString, replaceAll: replace_all,
  })

  // KEY DECISION: Edit preserves the file's existing line endings — opposite of Write.
  writeTextContent(absPath, updatedFile, encoding, lineEndings)
  // ----- END CRITICAL SECTION -----

  notifyLsp(absPath, updatedFile)
  notifyVscodeFileUpdated(absPath, orig, updatedFile)
  ctx.readFileState.set(absPath, {
    content: updatedFile, timestamp: getFileModificationTime(absPath),
    offset: undefined, limit: undefined,
  })

  // Telemetry
  if (absPath.endsWith(`${sep}CLAUDE.md`)) logEvent('tengu_write_claudemd', {})
  countLinesChanged(patch)
  logFileOperation({operation: 'edit', tool: 'FileEditTool', filePath: absPath})
  logEvent('tengu_edit_string_lengths', {
    oldStringBytes: byteLength(old_string), newStringBytes: byteLength(new_string),
    replaceAll: replace_all,
  })

  let gitDiff = process.env.CLAUDE_CODE_REMOTE ? await fetchSingleFileGitDiff(absPath) : undefined

  return { data: {
    filePath: file_path,
    oldString: actualOldString,
    newString: new_string,
    originalFile: orig,
    structuredPatch: patch,
    userModified: ctx.userModified ?? false,
    replaceAll: replace_all,
    ...(gitDiff && { gitDiff }),
  }}
}
```

### 2.7 `applyEditToFile` and `getPatchForEdit`

The actual replacement step has one subtle case: deletions whose `old_string` doesn't end in `\n`.

```ts
function applyEditToFile(orig, oldStr, newStr, replaceAll = false) {
  const apply = replaceAll
    ? (s, search, repl) => s.replaceAll(search, () => repl)   // function form prevents
    : (s, search, repl) => s.replace(search, () => repl)      // $-substitution interpretation

  if (newStr !== '') return apply(orig, oldStr, newStr)

  // Deletion: if oldStr doesn't end in \n but is followed by one in the file,
  // also consume that trailing newline so the deleted line doesn't leave a
  // blank line behind.
  const stripTrailingNewline =
    !oldStr.endsWith('\n') && orig.includes(oldStr + '\n')
  return stripTrailingNewline
    ? apply(orig, oldStr + '\n', newStr)
    : apply(orig, oldStr, newStr)
}
```

The `() => repl` function form on `replace`/`replaceAll` is critical: a literal string replacement interprets `$&`, `$1`, etc. as backreferences. The function form is opaque.

`getPatchForEdit` calls `applyEditToFile`, then runs `getPatchFromContents` with `convertLeadingTabsToSpaces` on both sides. For multi-edit pipelines (`getPatchForEdits`), apply edits sequentially and reject when:

- An edit's `old_string` (after stripping trailing `\n`s) is a substring of any *previously applied* `new_string` — would silently re-edit prior changes:

  ```
  Cannot edit file: old_string is a substring of a new_string from a previous edit.
  ```

- An edit produces no change vs. the previous content: `"String not found in file. Failed to apply edit."`
- All edits combined produce `updatedFile === fileContents`: `"Original and edited file match exactly. Failed to apply edit."`

### 2.8 `preserveQuoteStyle`

When the match required curly→straight normalization, the new content should also use the file's curly-quote convention so the edit doesn't "downgrade" the typography:

```ts
function preserveQuoteStyle(oldString, actualOldString, newString) {
  if (oldString === actualOldString) return newString          // exact match, no normalization

  const hasDouble = actualOldString.includes('“') || actualOldString.includes('”')
  const hasSingle = actualOldString.includes('‘') || actualOldString.includes('’')
  if (!hasDouble && !hasSingle) return newString

  let result = newString
  if (hasDouble) result = applyCurlyDoubleQuotes(result)
  if (hasSingle) result = applyCurlySingleQuotes(result)
  return result
}
```

`applyCurlyDoubleQuotes` walks the string, replacing each `"` with the open-or-close curly variant based on context: opening if preceded by whitespace, start-of-string, `(`, `[`, `{`, em dash `—`, or en dash `–`; otherwise closing.

`applyCurlySingleQuotes` does the same for `'`, with one extra rule: an apostrophe between two letters (Unicode `\p{L}` on both sides) is a contraction (`don't`, `it's`) and always becomes `’` (right single curly).

### 2.9 `inputsEquivalent`

Used by the harness to detect when the model retried with a semantically identical edit (e.g., reordered whitespace). Two-stage:

1. **Literal equality** of all fields (fast path).
2. Otherwise, read the file, apply both edit-sets via `getPatchForEdits`, and compare the resulting `updatedFile`. If both sets throw, equal iff error messages match. If only one throws, not equal.

This is best-effort dedup — used to suppress UI flicker, not for correctness.

### 2.10 `normalizeFileEditInput` (model-output cleanup)

Optional pre-processor for raw model output, applied before validation:

1. **Markdown-aware whitespace strip.** For non-`.md`/`.mdx` files, strip trailing whitespace per line in `new_string` (`stripTrailingWhitespace`). Skip for markdown — two trailing spaces are a hard line break.
2. **De-sanitization.** Some models emit sanitized variants of XML-ish tags (`<n>` for `<name>`, `<fnr>` for `<function_results>`, `\n\nH:` for `\n\nHuman:`, etc.). If `old_string` doesn't literally match the file but the de-sanitized form does, swap both `old_string` and `new_string` through the same replacement table. Full table:

   ```
   <fnr>          → <function_results>
   <n> </n>       → <name> </name>
   <o> </o>       → <output> </output>
   <e> </e>       → <error> </error>
   <s> </s>       → <system> </system>
   <r> </r>       → <result> </result>
   < META_START > → <META_START>
   < META_END >   → <META_END>
   < EOT >        → <EOT>
   < META >       → <META>
   < SOS >        → <SOS>
   \n\nH:         → \n\nHuman:
   \n\nA:         → \n\nAssistant:
   ```

If file read fails (ENOENT), return the input unchanged — let `validateInput` produce the friendly error.

### 2.11 Render

```ts
mapToolResultToToolResultBlockParam(data, id) {
  const note = data.userModified
    ? '.  The user modified your proposed changes before accepting them. '
    : ''
  if (data.replaceAll)
    return { tool_use_id: id, type: 'tool_result',
      content: `The file ${data.filePath} has been updated${note}. All occurrences were successfully replaced.` }
  return { tool_use_id: id, type: 'tool_result',
    content: `The file ${data.filePath} has been updated successfully${note}.` }
}
```

`extractSearchText` empty (UI shows a structured diff, not the raw text).

---

## 3. NotebookEdit tool

### 3.1 Name, prompt

- **Name:** `NotebookEdit`
- **userFacingName:** `"Edit Notebook"`
- **maxResultSizeChars:** `100_000`
- **shouldDefer:** `true` (the harness can defer schema-loading until the model invokes it; rare tool)

Description (verbatim from the in-repo prompt — keep parity if you copy):

```
Completely replaces the contents of a specific cell in a Jupyter notebook (.ipynb file)
with new_source. Jupyter notebooks are interactive documents that combine code,
text, and visualizations, commonly used for data analysis and scientific computing. The
notebook_path parameter must be an absolute path, not a relative path. The cell_number
is 0-indexed. Use edit_mode=insert to add a new cell at the index specified by
cell_id. Use edit_mode=delete to delete the cell at the index specified by cell_id.
```

(Adjust to match whatever prompt your harness uses.)

### 3.2 Input schema

```ts
{
  notebook_path: string,                          // required, absolute, must end in .ipynb
  cell_id?:      string,                           // cell ID, or "cell-N" for index N
  new_source:    string,                           // new cell source (ignored when edit_mode=delete)
  cell_type?:    'code' | 'markdown',              // required when edit_mode='insert'
  edit_mode?:    'replace' | 'insert' | 'delete',  // default 'replace'
}
```

### 3.3 Output schema

```ts
{
  new_source:     string,
  cell_id?:       string,
  cell_type:      'code' | 'markdown',
  language:       string,
  edit_mode:      string,
  error?:         string,                          // populated on failure (then is_error: true in render)
  notebook_path:  string,
  original_file:  string,                          // pre-edit notebook JSON
  updated_file:   string,                          // post-edit notebook JSON
}
```

### 3.4 validateInput

1. Resolve to absolute path. If not absolute, `path.resolve(getCwd(), notebook_path)`.
2. UNC short-circuit.
3. Extension check: must be `.ipynb`. Else `errorCode: 2`:

   ```
   File must be a Jupyter notebook (.ipynb file). For editing other file types, use the FileEdit tool.
   ```

4. `edit_mode` enum check → `errorCode: 4`.
5. `edit_mode === 'insert' && !cell_type` → `errorCode: 5`: `"Cell type is required when using edit_mode=insert."`
6. **Read-before-write.** Same as Edit/Write. → `errorCode: 9`.
7. **Mtime staleness.** Same as Edit/Write but without the Windows content-fallback (notebook content isn't reliably comparable post-CRLF normalization due to embedded outputs). → `errorCode: 10`.
8. `readFileSyncWithMetadata(fullPath).content`. ENOENT → `errorCode: 1`: `"Notebook file does not exist."`
9. `safeParseJSON(content) → NotebookContent | null`. Null → `errorCode: 6`: `"Notebook is not valid JSON."`
10. `cell_id` resolution:
    - Missing `cell_id` and `edit_mode !== 'insert'` → `errorCode: 7`: `"Cell ID must be specified when not inserting a new cell."`
    - Find by exact `cell.id` match. If not found, parse as `cell-N` numeric index via `parseCellId`.
    - Numeric index out of range → `errorCode: 7`: `"Cell with index {N} does not exist in notebook."`
    - Neither match form succeeded → `errorCode: 8`: `"Cell with ID \"{cell_id}\" not found in notebook."`

### 3.5 Executor

```ts
async call(input, ctx, _, parentMessage) {
  const fullPath = isAbsolute(input.notebook_path)
    ? input.notebook_path
    : resolve(getCwd(), input.notebook_path)

  if (fileHistoryEnabled())
    await fileHistoryTrackEdit(ctx.updateFileHistoryState, fullPath, parentMessage.uuid)

  const { content, encoding, lineEndings } = readFileSyncWithMetadata(fullPath)

  // CRITICAL: do NOT use a memoized JSON parser here. The harness caches by
  // content string and returns shared references; we mutate the notebook in
  // place (cells.splice, targetCell.source = ...) which would poison the cache
  // for validateInput() and any subsequent call.
  let notebook: NotebookContent
  try { notebook = jsonParse(content) }
  catch { return { data: { ...errorPayload, error: 'Notebook is not valid JSON.' }}}

  // Resolve cell index — same logic as validateInput, but on the parsed notebook
  let cellIndex: number
  if (!input.cell_id) {
    cellIndex = 0                          // default: insert at beginning
  } else {
    cellIndex = notebook.cells.findIndex(c => c.id === input.cell_id)
    if (cellIndex === -1) {
      const parsed = parseCellId(input.cell_id)
      if (parsed !== undefined) cellIndex = parsed
    }
    if (input.edit_mode === 'insert') cellIndex += 1     // insert AFTER the named cell
  }

  // Edge case: replace at one-past-the-end → coerce to insert
  let edit_mode = input.edit_mode ?? 'replace'
  let cell_type = input.cell_type
  if (edit_mode === 'replace' && cellIndex === notebook.cells.length) {
    edit_mode = 'insert'
    cell_type ??= 'code'
  }

  const language = notebook.metadata.language_info?.name ?? 'python'

  // Generate cell_id for nbformat 4.5+
  let new_cell_id: string | undefined
  if (notebook.nbformat > 4 ||
     (notebook.nbformat === 4 && notebook.nbformat_minor >= 5)) {
    if (edit_mode === 'insert') new_cell_id = randomId()
    else if (input.cell_id !== null) new_cell_id = input.cell_id
  }

  // Apply the edit
  if (edit_mode === 'delete') {
    notebook.cells.splice(cellIndex, 1)
  } else if (edit_mode === 'insert') {
    const newCell: NotebookCell = (cell_type === 'markdown')
      ? { cell_type: 'markdown', source: input.new_source, metadata: {}, ...(new_cell_id && {id: new_cell_id}) }
      : { cell_type: 'code',     source: input.new_source, metadata: {}, outputs: [], execution_count: null,
          ...(new_cell_id && {id: new_cell_id}) }
    notebook.cells.splice(cellIndex, 0, newCell)
  } else {  // replace
    const cell = notebook.cells[cellIndex]
    cell.source = input.new_source
    if (cell_type) cell.cell_type = cell_type
    // Replacing a code cell → wipe outputs (they refer to the prior source).
    if (cell.cell_type === 'code') { cell.outputs = []; cell.execution_count = null }
  }

  const updated = jsonStringify(notebook)              // pretty-printed; matches Jupyter's on-disk format
  writeTextContent(fullPath, updated, encoding, lineEndings)

  // Update readFileState with the new content so subsequent edits see the fresh mtime
  ctx.readFileState.set(fullPath, {
    content: updated, timestamp: getFileModificationTime(fullPath),
    offset: undefined, limit: undefined,
  })

  return { data: {
    new_source: input.new_source,
    cell_id: new_cell_id ?? input.cell_id,
    cell_type: cell_type ?? 'code',
    language, edit_mode,
    notebook_path: fullPath,
    original_file: content,
    updated_file: updated,
  }}
}
```

`randomId()`: `Math.random().toString(36).substring(2, 15)` is sufficient. Jupyter doesn't require any specific format.

### 3.6 Render

```ts
mapToolResultToToolResultBlockParam({cell_id, edit_mode, new_source, error}, id) {
  if (error) return { tool_use_id: id, type: 'tool_result', content: error, is_error: true }
  switch (edit_mode) {
    case 'replace': return { tool_use_id: id, type: 'tool_result', content: `Updated cell ${cell_id} with ${new_source}` }
    case 'insert':  return { tool_use_id: id, type: 'tool_result', content: `Inserted cell ${cell_id} with ${new_source}` }
    case 'delete':  return { tool_use_id: id, type: 'tool_result', content: `Deleted cell ${cell_id}` }
    default:        return { tool_use_id: id, type: 'tool_result', content: 'Unknown edit mode' }
  }
}
```

---

## 4. Failure-mode reference

| Symptom                                       | Cause                                      | Tool fields / handling                                                                            |
|-----------------------------------------------|--------------------------------------------|---------------------------------------------------------------------------------------------------|
| "File has not been read yet"                  | `readFileState` missing or partial         | Reject. Force user to Read first. errorCode 2 (Write) / 6 (Edit) / 9 (NotebookEdit)               |
| "File has been modified since read"           | mtime > entry.timestamp, content differs   | Reject. errorCode 3 / 7 / 10. Windows content-fallback may admit the case                          |
| "File has been unexpectedly modified"         | Same race detected inside `call()`         | Throw `FILE_UNEXPECTEDLY_MODIFIED_ERROR` — caught by harness, model retries                       |
| "old_string and new_string are exactly same"  | No-op edit                                 | Edit errorCode 1, behavior 'ask'                                                                  |
| "String to replace not found"                 | Match failed even after curly-quote norm   | Edit errorCode 8, include `old_string` in message                                                 |
| "Found N matches but replace_all is false"    | Ambiguous edit                             | Edit errorCode 9, include count and `actualOldString` in `meta`                                   |
| "Cannot create new file - file already exists"| Edit with empty `old_string` on non-empty file | Edit errorCode 3                                                                              |
| "File does not exist" (Edit, non-empty old)   | ENOENT during validation                   | Edit errorCode 4. Suggest cwd-relative path or similar filename                                   |
| "File is too large to edit"                   | size > 1 GiB                               | Edit errorCode 10                                                                                  |
| "File is a Jupyter Notebook"                  | Edit on `.ipynb`                           | Edit errorCode 5. Redirect to NotebookEdit                                                        |
| "File must be a Jupyter notebook"             | NotebookEdit on non-`.ipynb`               | NotebookEdit errorCode 2. Redirect to Edit                                                        |
| "Notebook is not valid JSON"                  | JSON parse failure                         | NotebookEdit errorCode 6 (validate) or `error` field (call)                                       |
| "Cell with ID … not found"                    | Lookup failure                             | NotebookEdit errorCode 7 / 8                                                                      |
| Permission denied                             | `edit.deny` rule matched                   | All three: errorCode 1 / 2 (Edit). Behavior 'ask' on Edit                                         |
| UNC path                                      | `\\server\share\...`                       | All three: skip stat in validate, let executor handle / fail naturally                            |
| Team-memory secret                            | Secret detected in `content`/`new_string`  | All three: errorCode 0                                                                            |
| Settings-file schema invalid post-edit        | Edit would corrupt settings.json           | Edit: returned by `validateInputForSettingsFileEdit`                                              |
| `old_string` is substring of prior `new_string` (multi-edit)  | Edit chain re-edits its own output | Throw `"Cannot edit file: old_string is a substring of a new_string from a previous edit."`       |
| Edit produced no change                       | string match collapsed (e.g. quote norm)   | Throw `"String not found in file. Failed to apply edit."`                                         |
| Edit produced identical output                | All replacements were no-ops               | Throw `"Original and edited file match exactly. Failed to apply edit."`                            |
| Empty file, empty inputs                      | Edit with `old_string=''`, `new_string=''` on empty file | Special-cased in `getPatchForEdits` — returns empty patch + empty content       |

---

## 5. Atomicity & race-condition checklist

These are the failure modes that don't show up under load testing on a quiet workstation but will bite you in production:

1. **Concurrent Edit + Edit on same file.** Critical sections (`readFileSyncWithMetadata` → `writeTextContent`) are sync; the harness should also serialize per-file at a higher level. Result: second Edit sees first Edit's mtime in `readFileState` (post-write update), proceeds normally. If the harness does not serialize, the staleness check still catches it on the second call.
2. **External editor saves between Read and Edit.** mtime check fires; user is told to re-Read.
3. **Linter reformats file between Read and Edit.** Same as #2. Windows content-fallback admits no-op formatters.
4. **Cloud-sync touches file without changing bytes (Windows).** mtime changes; content-fallback for full reads admits the case. Partial reads (offset/limit set) reject — they can't byte-compare safely.
5. **Process killed mid-write.** `writeFileSyncAndFlush` calls `fsync` so the file is either fully old or fully new; no half-written state. The history backup (§0.7) provides a recovery path either way.
6. **Read returns 100 lines from a 10K-line file, then Edit.** `isPartialView: true` (or `offset`/`limit` set) → Edit rejects. The model has to Read the full file before mutating.
7. **Read of a path, Edit of the same path under a different spelling (relative vs. absolute, `~` vs. expanded).** `expandPath` is applied identically in both `Read` and `Edit` `getPath`/`backfillObservableInput`/`call`, so they hit the same `readFileState` key.
8. **Line-ending bait.** Write a file with explicit `\n`s into a CRLF-using repo. Write *intentionally* writes LF — preserve the model's intent. Edit *intentionally* keeps CRLF — preserve the file's local convention. If your tests fail because of this asymmetry, do not "fix" it: the asymmetry is load-bearing (see KEY DECISION comments in §1.5 and §2.6).
9. **Notebook with mutated parsed object cached.** Use a non-memoized JSON parser in `NotebookEdit.call()`. A memoized parser keyed by string returns shared references; `cells.splice` would corrupt every other validator's view of the same notebook string.

---

## 6. Sanity test checklist

15 cases. If all pass, you have parity with the reference implementation.

1. `Write` of a brand-new file: returns `type: 'create'`, no Read needed. Subsequent Edit succeeds without an intervening Read because `Write` populates `readFileState`.
2. `Write` over an existing file with no prior Read: rejected with errorCode 2.
3. `Write` over an existing file after a Read, with no external mutation: succeeds, returns `type: 'update'` with structured patch.
4. `Write` after a Read, with mtime advanced and content unchanged on Windows: succeeds via the content-fallback path.
5. `Write` after a Read, with content changed: rejected with errorCode 3.
6. `Write` of CRLF-using existing file with `content` containing `\n`: file on disk is LF after write.
7. `Edit` after a Read with `old_string` not in file: rejected with errorCode 8 referencing the missing string.
8. `Edit` with `old_string` matching twice and `replace_all: false`: rejected with errorCode 9 reporting count = 2.
9. `Edit` with `old_string` matching twice and `replace_all: true`: succeeds, both replaced.
10. `Edit` with `old_string` containing straight `"` against a file containing curly `“ ”`: succeeds. The output retains curly quotes (`preserveQuoteStyle`).
11. `Edit` whose `new_string === ''` on a line not ending in `\n`: trailing newline is consumed (no blank line left behind).
12. `Edit` of `~/.claude/settings.json` that would produce invalid JSON: rejected by settings validator.
13. `Edit` of an `.ipynb` file: rejected with errorCode 5, redirected to NotebookEdit.
14. `NotebookEdit` `replace` of a code cell: outputs and `execution_count` cleared on the replaced cell.
15. `NotebookEdit` `insert` after the last cell: cell is appended, gets a fresh random id under nbformat 4.5+.

Two extra red-flag tests, in case you got tempted to deviate:

- **Sample line endings from the repo for new files (Write).** Don't. The reference deliberately *removed* this and writes LF. Adding it back will silently corrupt scripts.
- **Use a sync `await fs.writeFile` after the read.** Don't. The "no awaits in the critical section" rule isn't aesthetic; it's the only thing standing between you and concurrent-edit corruption.
