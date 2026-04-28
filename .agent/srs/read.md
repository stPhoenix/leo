# Read, Find (Glob), Search (Grep) — Implementation Guide

This document specifies three tools an AI coding agent uses to inspect a local filesystem: **Read** (file contents), **Find** (file paths by glob), and **Search** (file contents by regex). It is written so a developer in another repo can re-implement the tools from scratch in any language. Examples below are in TypeScript pseudo-code, but the contracts are language-agnostic.

The three tools share a common pattern:
- pure JSON-schema input
- a permission/validation pre-flight that performs **no I/O** until safety checks pass
- an executor that returns a structured `data` payload
- a separate "render" step that maps the payload to the model-facing tool result

Implement them in this order: helpers → Read → Find → Search.

---

## 0. Cross-cutting infrastructure

Build these utilities first. All three tools depend on them.

### 0.1 Path expansion (`expandPath`)

Normalize the user-supplied `file_path` / `path` argument:

1. If path begins with `~` or `~user`, expand to the user's home dir.
2. Trim leading/trailing whitespace (paths copied from terminals frequently have trailing spaces).
3. Normalize Windows separators (`/` ↔ `\`) to the platform's native form.
4. Resolve to absolute via `path.resolve`. Do **not** follow symlinks here (deferred to fs ops).

Use the same expansion in *all three* tools and in any `getPath` / observable-input hook so permission rules can't be bypassed via `~` or `..` indirection.

### 0.2 Cwd-relativization (`toRelativePath`)

When emitting paths back to the model, relativize anything under `cwd` to save tokens:

```
/home/bs/proj/src/main.ts   →  src/main.ts
/etc/hosts                   →  /etc/hosts        (outside cwd, leave absolute)
```

### 0.3 UNC path guard

On Windows, `\\server\share\...` and `//server/share/...` are UNC paths. Touching them with `stat()` can leak NTLM credentials to a hostile SMB server. **Skip all filesystem operations** during validation when the path starts with `\\` or `//` — let the actual read attempt fail later if the path is bogus. This is a security requirement, not an optimization.

### 0.4 Binary extension table

Maintain a static `Set` of binary file extensions (lowercase, with leading dot). Reject these in Read's `validateInput` with a friendly error directing the user toward more appropriate tools. Excerpt of mandatory entries:

```
images:    .png .jpg .jpeg .gif .bmp .ico .webp .tiff .tif
videos:    .mp4 .mov .avi .mkv .webm .wmv .flv .m4v .mpeg .mpg
audio:     .mp3 .wav .ogg .flac .aac .m4a .wma .aiff .opus
archives:  .zip .tar .gz .bz2 .7z .rar .xz .z .tgz .iso
binaries:  .exe .dll .so .dylib .bin .o .a .obj .lib .app .msi .deb .rpm
docs:      .pdf .doc .docx .xls .xlsx .ppt .pptx .odt .ods .odp
fonts:     .ttf .otf .woff .woff2 .eot
bytecode:  .pyc .pyo .class .jar .war .ear .node .wasm .rlib
db:        .sqlite .sqlite3 .db .mdb .idx
design/3d: .psd .ai .eps .sketch .fig .xd .blend .3ds .max
flash:     .swf .fla
lock/data: .lockb .dat .data
```

Read **excludes** PDF, the image set, and SVG from the rejection (it renders them natively); see §1.3.

A separate `isBinaryContent(buffer)` heuristic looks at the first 8 KB: any null byte → binary; otherwise count bytes outside printable ASCII range (excluding `\t\n\r`) and return true when >10 % are non-printable. Useful for files whose extension lies (e.g. `.txt` containing a UTF-16 BOM blob).

### 0.5 Permission model

A `ToolPermissionContext` should expose:

- `read_allow` / `read_deny` glob rules
- `getFileReadIgnorePatterns()` — extra patterns (e.g. `.env`, `secrets/**`)

Implement two helpers:

- `matchingRuleForInput(path, ctx, 'read', 'deny') → rule | null` — pure path/glob match, no I/O
- `checkReadPermissionForTool(tool, input, ctx) → PermissionDecision` — returns `allow | ask | deny` for the harness to act on

All three tools' `checkPermissions` is a one-liner that defers to `checkReadPermissionForTool`. They are all `isReadOnly: true` and `isConcurrencySafe: true`.

### 0.6 Tool definition shape

Each tool is an object with these fields. Names match the implementation in this repo so they line up with the rest of the discussion:

| Field | Purpose |
|-------|---------|
| `name` | Stable identifier sent to the model (`Read`, `Glob`, `Grep`) |
| `description` / `prompt` | Human-readable doc rendered into the system prompt |
| `inputSchema` | JSON schema (Zod, pydantic, etc.) — the model fills this in |
| `outputSchema` | JSON schema for the structured `data` your `call()` returns |
| `validateInput(input, ctx)` | Cheap, mostly pure checks — no I/O if avoidable. Returns `{result: true}` or `{result: false, message, errorCode}` |
| `checkPermissions(input, ctx)` | Returns `allow` / `ask` / `deny` based on permission rules |
| `getPath(input)` | Returns the path the user is operating on, used for permission UX |
| `preparePermissionMatcher(input)` | Returns a function `(rulePattern) → boolean` for matching wildcard permission rules against this specific call |
| `isReadOnly()` / `isConcurrencySafe()` | Both `true` for these three tools |
| `isSearchOrReadCommand()` | `{isSearch, isRead}` — used for telemetry / classification |
| `call(input, ctx)` | The executor — returns `{data: <Output>, newMessages?: ...}` |
| `mapToolResultToToolResultBlockParam(data, toolUseID)` | Renders `data` into the API tool-result block |
| `extractSearchText(data)` | What text the harness should index for fuzzy search of past tool results |
| `maxResultSizeChars` | Cap on the rendered content size before persistence (Read: `Infinity`, Glob: 100 000, Grep: 20 000) |

The tool object is registered with the harness; the model sees only `name`, `description`, and `inputSchema`.

---

## 1. Read tool

### 1.1 Name, prompt, output cap

- **Name:** `Read`
- **maxResultSizeChars:** `Infinity` — the output is bounded by `maxTokens` (see §1.7), and persisting Read output to a file the model would re-read with Read is circular.
- **searchHint:** `"read files, images, PDFs, notebooks"`

The model-facing description (rendered each turn, with placeholders filled in at runtime):

```
Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path
to a file assume that path is valid. It is okay to read a file that does not exist; an
error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file{maxSizeInstruction}
{offsetInstruction}
- Results are returned using cat -n format, with line numbers starting at 1
- This tool allows the agent to read images (eg PNG, JPG, etc). When reading an image
  file the contents are presented visually.
- This tool can read PDF files (.pdf). For large PDFs (more than 10 pages), you MUST
  provide the pages parameter to read specific page ranges (e.g., pages: "1-5"). Reading
  a large PDF without the pages parameter will fail. Maximum 20 pages per request.
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their
  outputs, combining code, text, and visualizations.
- This tool can only read files, not directories. To read a directory, use a Bash `ls`.
- You will regularly be asked to read screenshots. If the user provides a path to a
  screenshot, ALWAYS use this tool to view the file at the path. This tool will work
  with all temporary file paths.
- If you read a file that exists but has empty contents you will receive a system
  reminder warning in place of file contents.
```

`maxSizeInstruction` is appended only if you choose to expose `maxSizeBytes` in the prompt; default: `"Files larger than 256 KB will return an error; use offset and limit for larger files"`.

`offsetInstruction` is one of:

- *Default:* `"You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters"`
- *Targeted:* `"When you already know which part of the file you need, only read that part. This can be important for larger files."`

### 1.2 Input schema

```ts
{
  file_path: string,                        // required, absolute path
  offset?:  integer >= 0,                   // 1-indexed line number; 0 means "from start"
  limit?:   integer >  0,                   // line count
  pages?:   string                          // PDF only, e.g. "1-5", "3", "10-20"
}
```

Constants the schema references:

```
PDF_MAX_PAGES_PER_READ          = 20    // upper bound on a single pages: range
PDF_AT_MENTION_INLINE_THRESHOLD = 10    // PDFs over this many pages require pages:
PDF_EXTRACT_SIZE_THRESHOLD      = 5*1024*1024  // PDFs larger than 5 MB go through extract path
MAX_LINES_TO_READ               = 2000  // default cap when limit is unspecified
FAST_PATH_MAX_SIZE              = 10*1024*1024 // text files > 10 MB use streaming reader
```

### 1.3 validateInput (no-I/O preflight)

In order — every step before §1.3.5 must be I/O-free:

1. **Pages syntax.** If `pages` is provided, parse `"a-b"`, `"a"`, or `"a-"` (open-ended). Pages are 1-indexed. Reject malformed input with `errorCode: 7`. Reject ranges over `PDF_MAX_PAGES_PER_READ` with `errorCode: 8`.
2. **expandPath** the `file_path`.
3. **Deny-rule check.** If a `read.deny` rule matches, return `errorCode: 1` with message: `"File is in a directory that is denied by your permission settings."`
4. **UNC short-circuit.** If `file_path` starts with `\\` or `//`, return `{result: true}` immediately and let the executor handle it. Do not stat — see §0.3.
5. **Binary extension reject.** If `hasBinaryExtension(file_path)` and the extension is *not* a PDF and *not* in the image set, return `errorCode: 4` with: `"This tool cannot read binary files. The file appears to be a binary {ext} file. Please use appropriate tools for binary file analysis."`
6. **Blocked device paths.** Reject these with `errorCode: 9` and `"Cannot read '{path}': this device file would block or produce infinite output."`:
   - Infinite output: `/dev/zero`, `/dev/random`, `/dev/urandom`, `/dev/full`
   - Blocking input: `/dev/stdin`, `/dev/tty`, `/dev/console`
   - Nonsensical: `/dev/stdout`, `/dev/stderr`
   - FD aliases: `/dev/fd/0`, `/dev/fd/1`, `/dev/fd/2`
   - Linux equivalents: `/proc/<anything>/fd/0|1|2` (match by prefix `/proc/` and suffix `/fd/0|1|2`)

   `/dev/null` is intentionally allowed.

### 1.4 Read-state cache (`readFileState`)

Maintain a per-session `Map<absolutePath, { content, timestamp, offset, limit, isPartialView? }>`. Other tools (Edit, Write) use this to detect stale reads and force the agent to re-Read before mutating.

- Key: post-`expandPath` absolute path.
- `timestamp`: `Math.floor(stats.mtimeMs)` taken from the same fd you used to read (avoid TOCTOU).
- `offset` / `limit`: exactly what the user passed in (so dedup can compare).
- Set this **after** every successful text or notebook read (images and PDFs are not cached here).

### 1.5 Dedup (the `file_unchanged` stub)

Before reading, check whether the same `(path, offset, limit)` was already read in this session and the file's mtime is unchanged. If so, return:

```ts
{
  data: {
    type: 'file_unchanged',
    file: { filePath: <original input file_path> }
  }
}
```

The renderer turns this into:

```
File unchanged since last read. The content from the earlier Read tool_result in this
conversation is still current — refer to that instead of re-reading.
```

Rules:

- Skip dedup for entries whose `offset` is `undefined` (those came from Edit/Write, not Read; their mtime is post-mutation and would point the model at pre-mutation content).
- Skip dedup for entries with `isPartialView === true`.
- Skip when a feature-flag killswitch is set (`tengu_read_dedup_killswitch`).
- If the `stat()` call fails, fall through to a full read.
- Image/PDF/notebook reads never hit the dedup path because they aren't stored in `readFileState`.

This saves significant cache-creation tokens on long sessions where the model re-reads the same file.

### 1.6 ENOENT recovery

If the underlying read throws `ENOENT`:

1. **macOS screenshot retry.** macOS screenshot filenames can use either a regular space or U+202F (narrow no-break space) before `AM` / `PM`:

   ```
   Screenshot 2024-01-01 at 12.34.56 PM.png       (regular space)
   Screenshot 2024-01-01 at 12.34.56 PM.png       (U+202F before AM/PM)
   ```

   When a path matches `/^(.+)([  ])(AM|PM)(\.png)$/`, retry once with the alternate space character. Only re-throw if that also ENOENTs.

2. **Suggestion message.** Build:

   ```
   File does not exist. Note: your current working directory is {cwd}.
   ```

   Append `"Did you mean {x}?"` where `x` is, in order of preference:
   - The first match from `suggestPathUnderCwd(absPath)` — search cwd recursively for a basename match
   - The first match from `findSimilarFile(path)` — Levenshtein-style nearest match in the same directory

### 1.7 Output limits

Two caps apply to text reads:

| Limit          | Default | Checks                       | When it fires          | On overflow       |
|----------------|---------|------------------------------|------------------------|-------------------|
| `maxSizeBytes` | 256 KB  | TOTAL FILE SIZE (not output) | One stat, before read  | Throws pre-read   |
| `maxTokens`    | 25 000  | Actual rendered tokens       | After read, may use API| Throws post-read  |

Implementation note: keep the byte cap on *file* size (not slice size). When the model passes an explicit `limit`, **disable** the byte cap so it can read a slice of a 10 MB file. The token cap still applies. Tested swapping throw → truncate for over-cap reads and tool-error rate dropped, but mean tokens rose: the throw path emits ~100 bytes of error, truncation emits 25 K tokens of content.

`maxTokens` precedence: env var (`CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS`) > runtime override (e.g. feature flag) > `25 000`.

### 1.8 Token validation

After producing the text/notebook content but before returning it:

1. Quick estimate: `roughTokenCountEstimationForFileType(content, ext)` — heuristic chars-per-token by extension.
2. If the rough estimate is `≤ maxTokens / 4`, accept it and skip the API call.
3. Otherwise call the tokenizer API for an exact count.
4. If the count exceeds `maxTokens`, throw a `MaxFileReadTokenExceededError` with this message:

   ```
   File content ({tokenCount} tokens) exceeds maximum allowed tokens ({maxTokens}).
   Use offset and limit parameters to read specific portions of the file, or search
   for specific content instead of reading the whole file.
   ```

### 1.9 Dispatch by extension

```
ext == 'ipynb'                             → notebook path  (§1.10)
ext in {png,jpg,jpeg,gif,webp}             → image path     (§1.11)
ext in {pdf}                               → PDF path       (§1.12)
otherwise                                  → text path      (§1.13)
```

### 1.10 Notebook path

1. Parse the `.ipynb` JSON.
2. Extract cells: `[{cell_type, source, outputs?, execution_count?}, ...]`.
3. JSON-stringify the cells.
4. If the stringified bytes exceed `maxSizeBytes`, throw with this hint (substituting Bash tool name):

   ```
   Notebook content ({size}) exceeds maximum allowed size ({max}). Use Bash with jq:
     cat "{path}" | jq '.cells[:20]'                                        # First 20 cells
     cat "{path}" | jq '.cells[100:120]'                                    # Cells 100-120
     cat "{path}" | jq '.cells | length'                                    # Count total cells
     cat "{path}" | jq '.cells[] | select(.cell_type=="code") | .source'    # All code sources
   ```

5. Run §1.8 token validation on the JSON.
6. `stat()` the file once for `mtimeMs`; store in `readFileState`.
7. Return:

   ```ts
   { type: 'notebook', file: { filePath, cells } }
   ```

### 1.11 Image path

`readImageWithTokenBudget(path, maxTokens)`:

1. Read the image bytes **once** (optionally capped at `maxBytes` to avoid OOM on huge files).
2. Reject empty buffer with `"Image file is empty: {path}"`.
3. Detect format from magic bytes (PNG `89 50 4e 47`, JPEG `ff d8 ff`, GIF `47 49 46`, WEBP `52 49 46 46 ... 57 45 42 50`).
4. Try `maybeResizeAndDownsampleImageBuffer(buffer, originalSize, format)` — clamp to API max dimension, downsample large images. Returns `{buffer, mediaType, dimensions: {originalWidth, originalHeight, displayWidth, displayHeight}}`.
5. Estimate tokens as `ceil(base64Length * 0.125)`. If under `maxTokens`, return as-is.
6. If over: aggressive `compressImageBufferWithTokenLimit(buffer, maxTokens, mediaType)` — iteratively reduce JPEG quality / dimensions until it fits. Last-resort fallback: 400×400, JPEG quality 20. If even that fails, return the raw buffer.

Output:

```ts
{
  type: 'image',
  file: {
    base64,
    type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
    originalSize,
    dimensions?: {originalWidth, originalHeight, displayWidth, displayHeight}
  }
}
```

When `dimensions` is present, also emit a metadata user-message (so the model knows the resize ratio):

```ts
newMessages: [{ role: 'user', isMeta: true, content: createImageMetadataText(dimensions) }]
```

### 1.12 PDF path

If `pages` is provided:

1. Run `extractPDFPages(path, parsedRange)` — uses `poppler-utils` (`pdftoppm`) to render the page range to JPEGs in a temp dir.
2. Read each JPEG, run it through the same image resize pipeline, and emit an image block per page.
3. Return:

   ```ts
   {
     type: 'parts',
     file: { filePath, originalSize, count: <pages>, outputDir: <tmp> }
   }
   ```

   plus `newMessages` with one `image` block per extracted page.

If `pages` is not provided:

1. Get `pageCount` (cheap PDF metadata read).
2. If `pageCount > PDF_AT_MENTION_INLINE_THRESHOLD` (10), throw:

   ```
   This PDF has {n} pages, which is too many to read at once. Use the pages parameter
   to read specific page ranges (e.g., pages: "1-5"). Maximum 20 pages per request.
   ```

3. If the model doesn't support PDFs natively (older Sonnet etc.) **or** file size > `PDF_EXTRACT_SIZE_THRESHOLD` (5 MB), call `extractPDFPages` (no range = all pages) and emit images.
4. Otherwise, base64-encode the whole PDF and return:

   ```ts
   {
     type: 'pdf',
     file: { filePath, base64, originalSize }
   }
   ```

   with `newMessages` containing a single `document` block (`{type: 'document', source: {type: 'base64', media_type: 'application/pdf', data: base64}}`).

If poppler is unavailable and the model can't handle PDFs natively:

```
Reading full PDFs is not supported with this model. Use a newer model (Sonnet 3.5 v2
or later), or use the pages parameter to read specific page ranges (e.g., pages: "1-5",
maximum 20 pages per request). Page extraction requires poppler-utils: install with
`brew install poppler` on macOS or `apt-get install poppler-utils` on Debian/Ubuntu.
```

### 1.13 Text path

```ts
const lineOffset = offset === 0 ? 0 : offset - 1   // 1→0-indexed
const { content, lineCount, totalLines, totalBytes, readBytes, mtimeMs } =
  await readFileInRange(
    resolvedPath,
    lineOffset,
    limit,
    limit === undefined ? maxSizeBytes : undefined,   // disable byte cap when slicing
    abortSignal,
  )
```

`readFileInRange` is described in §1.14. After it returns:

1. Run §1.8 token validation on `content`.
2. Update `readFileState[absPath] = {content, timestamp: floor(mtimeMs), offset, limit}`.
3. Return:

   ```ts
   {
     type: 'text',
     file: { filePath, content, numLines: lineCount, startLine: offset, totalLines }
   }
   ```

### 1.14 `readFileInRange` — line-oriented file reader

Returns lines `[offset, offset+maxLines)` from a file, plus totals. Two code paths chosen by `stat()`:

**Fast path** (regular file, size < `FAST_PATH_MAX_SIZE = 10 MB`):
1. Optional pre-check: if `truncateOnByteLimit === false` and `maxBytes` is set and `stats.size > maxBytes`, throw `FileTooLargeError`.
2. `readFile(path, 'utf8')`.
3. Strip leading BOM (`U+FEFF`).
4. Iterate `text.indexOf('\n')`, slice each line, strip trailing `\r`. Push only lines whose `lineIndex` is in the requested range. The final fragment (no trailing newline) counts as one line.
5. `totalLines` is the post-loop `lineIndex` (so a one-line file with no trailing `\n` returns `totalLines: 1`).
6. Return `{content, lineCount, totalLines, totalBytes: byteLength(text), readBytes: byteLength(content), mtimeMs}`.

**Streaming path** (anything else — large files, FIFOs, devices):
1. Open `createReadStream(path, {encoding: 'utf8', highWaterMark: 512*1024})`.
2. On `'open'`, `fstat(fd)` for `mtimeMs`. (Stat from the open fd, not a separate `fs.stat` call — avoids TOCTOU.)
3. On each `'data'` chunk:
   - First chunk: strip BOM if present.
   - Track `totalBytesRead`. If `truncateOnByteLimit === false` and total exceeds `maxBytes`, `stream.destroy(FileTooLargeError(...))` (emits `'error'` → reject).
   - Concat the carried `partial` from the previous chunk; scan `\n` boundaries.
   - Push lines that fall inside the requested range. **Outside the range, count newlines but discard the bytes** so reading line 1 of a 100 GB file doesn't blow up RSS.
   - Save the trailing fragment as `partial` only when inside the range.
4. On `'end'`, push the final `partial` (with `\r` stripped) if the line index still falls inside the range.
5. Both paths strip `\r` from line ends so CRLF and LF look identical to the model.

`FileTooLargeError` message:

```
File content ({sizeFormatted}) exceeds maximum allowed size ({maxFormatted}). Use
offset and limit parameters to read specific portions of the file, or search for
specific content instead of reading the whole file.
```

`truncateOnByteLimit: true` mode (used for some Edit/Write internals, optional for Read): instead of throwing, stop accumulating once the next line would push past `maxBytes`, set `truncatedByBytes: true`, and continue counting `totalLines`.

If `stats.isDirectory()`, throw before doing anything else: `EISDIR: illegal operation on a directory, read '{path}'`.

### 1.15 Rendering (`mapToolResultToToolResultBlockParam`)

Convert the structured `data` into the tool result block sent to the API.

```ts
case 'text': {
  let content: string
  if (data.file.content) {
    content =
      memoryFileFreshnessPrefix(data) +
      addLineNumbers({content: data.file.content, startLine: data.file.startLine}) +
      (shouldIncludeFileReadMitigation() ? CYBER_RISK_MITIGATION_REMINDER : '')
  } else {
    content = data.file.totalLines === 0
      ? '<system-reminder>Warning: the file exists but the contents are empty.</system-reminder>'
      : `<system-reminder>Warning: the file exists but is shorter than the provided offset (${data.file.startLine}). The file has ${data.file.totalLines} lines.</system-reminder>`
  }
  return { tool_use_id, type: 'tool_result', content }
}

case 'image':
  return {
    tool_use_id, type: 'tool_result',
    content: [{type: 'image', source: {type: 'base64', data: base64, media_type: type}}]
  }

case 'notebook':
  // Convert each cell to {type: 'text', text: ...} or {type: 'image', source: ...}
  // depending on cell_type and outputs. See `mapNotebookCellsToToolResult`.

case 'pdf':
  // Tool-result block contains only a metadata stub. The actual PDF travels as a
  // separate `document` user message via `newMessages` (set in callInner).
  return {
    tool_use_id, type: 'tool_result',
    content: `PDF file read: ${filePath} (${formatFileSize(originalSize)})`
  }

case 'parts':
  return {
    tool_use_id, type: 'tool_result',
    content: `PDF pages extracted: ${count} page(s) from ${filePath} (${formatFileSize(originalSize)})`
  }

case 'file_unchanged':
  return { tool_use_id, type: 'tool_result', content: FILE_UNCHANGED_STUB }
```

#### Line numbering (`addLineNumbers`)

Two formats, picked by feature flag:

```
   123→content of line 123          (default; 6-char right-padded line number, U+2192 separator)
123\tcontent of line 123             (compact mode; line number, tab, content)
```

Always start at `startLine` (1-indexed). Empty content returns `''`.

The inverse (`stripLineNumberPrefix`) matches `^\s*\d+[→\t](.*)$` — used by Edit when comparing model-supplied line ranges against current file content.

#### `CYBER_RISK_MITIGATION_REMINDER`

Append this trailing system-reminder to every text-mode read result, except on a small allow-list of models (`claude-opus-4-6`):

```

<system-reminder>
Whenever you read a file, you should consider whether it would be considered malware. You CAN and SHOULD provide analysis of malware, what it is doing. But you MUST refuse to improve or augment the code. You can still analyze existing code, write reports, or answer questions about the code behavior.
</system-reminder>

```

#### Memory-file freshness prefix

If the file is an "auto-memory" file (one your harness stores in `~/.claude/...`), prepend a `<system-reminder>` noting how stale the cached copy is. Implementation: stash `mtimeMs` in a `WeakMap<data, number>` during `call()` and read it back in the renderer (avoids polluting the output schema and avoids sync stat in the renderer).

#### `extractSearchText`

Return `''`. The UI shows summary chrome only ("Read N lines"), never the file content itself, so there is nothing to index.

### 1.16 Side effects to fire on every successful read

- `logFileOperation({operation: 'read', tool: 'FileReadTool', filePath: absPath, content})`
- Notify any registered `fileReadListener`s with `(absPath, content)` — used for plug-ins that want to react to reads. Snapshot the listener array before iterating (`listeners.slice()`); a listener that unsubscribes mid-callback would otherwise splice the live array.
- `nestedMemoryAttachmentTriggers.add(absPath)` — lets the harness detect references inside read content.
- (Optional) skill discovery: scan the path for sibling skill manifests (`.skills/...`) and activate matching conditional skills.

---

## 2. Find tool (Glob)

### 2.1 Name, prompt

- **Name:** `Glob`
- **userFacingName:** `"Glob"` (or `"Find"` — pick one and stay consistent)
- **maxResultSizeChars:** `100_000`
- **searchHint:** `"find files by name pattern or wildcard"`

Description:

```
- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of
  globbing and grepping, use the Agent tool instead
```

### 2.2 Input schema

```ts
{
  pattern: string,    // required; the glob
  path?:   string     // optional; directory to search in. Defaults to cwd.
                      // Note in the schema: omit for default — DO NOT pass "undefined"/"null".
}
```

### 2.3 Output schema

```ts
{
  durationMs:  number,
  numFiles:    number,
  filenames:   string[],   // relative-to-cwd where possible
  truncated:   boolean
}
```

### 2.4 validateInput

If `path` is provided:
- `expandPath` it.
- UNC short-circuit (§0.3).
- `stat()`: ENOENT → `errorCode: 1`, message `"Directory does not exist: {path}. Note: your current working directory is {cwd}. Did you mean {suggestion}?"` (suggestion via `suggestPathUnderCwd`).
- Not a directory → `errorCode: 2`, `"Path is not a directory: {path}"`.

### 2.5 Executor

```ts
async call(input, ctx) {
  const start = Date.now()
  const limit = ctx.globLimits?.maxResults ?? 100
  const { files, truncated } = await glob(
    input.pattern,
    getPath(input),                    // expandPath(path) or cwd
    { limit, offset: 0 },
    ctx.abortController.signal,
    ctx.appState.toolPermissionContext,
  )
  return { data: {
    filenames: files.map(toRelativePath),
    durationMs: Date.now() - start,
    numFiles: files.length,
    truncated,
  }}
}
```

### 2.6 The `glob` helper

Implemented on top of ripgrep (see §4) for memory and speed. Ripgrep walks the tree, prunes via `.gitignore` toggles, and we rely on it to handle hidden files.

```ts
async function glob(filePattern, cwd, {limit, offset}, signal, permCtx) {
  let searchDir = cwd
  let searchPattern = filePattern

  // Absolute glob? Split static prefix from glob portion. ripgrep's --glob only
  // accepts relative patterns.
  if (path.isAbsolute(filePattern)) {
    const { baseDir, relativePattern } = extractGlobBaseDirectory(filePattern)
    if (baseDir) { searchDir = baseDir; searchPattern = relativePattern }
  }

  const ignorePatterns = normalizePatternsToPath(
    getFileReadIgnorePatterns(permCtx),
    searchDir,
  )

  // Defaults: --no-ignore (return everything, including .gitignored files);
  // --hidden (include dotfiles). Both togglable via env.
  const noIgnore = isEnvTruthy(process.env.CLAUDE_CODE_GLOB_NO_IGNORE || 'true')
  const hidden   = isEnvTruthy(process.env.CLAUDE_CODE_GLOB_HIDDEN     || 'true')

  const args = [
    '--files',                        // list files instead of searching contents
    '--glob', searchPattern,
    '--sort=modified',                // oldest first; we'll keep that order from rg
    ...(noIgnore ? ['--no-ignore'] : []),
    ...(hidden   ? ['--hidden']    : []),
  ]

  for (const p of ignorePatterns)              args.push('--glob', `!${p}`)
  for (const p of pluginCacheExclusions(searchDir)) args.push('--glob', p)

  const allPaths = await ripGrep(args, searchDir, signal)

  const absolutePaths = allPaths.map(p => path.isAbsolute(p) ? p : path.join(searchDir, p))
  const truncated = absolutePaths.length > offset + limit
  const files     = absolutePaths.slice(offset, offset + limit)
  return { files, truncated }
}
```

`extractGlobBaseDirectory(pattern)` splits a glob pattern into `(baseDir, relativePattern)` at the first glob meta-char (`*?[{`). Edge cases:

- No meta-chars: it's a literal path. Return `dirname` and `basename`.
- Meta-char before any `/`: pattern is cwd-relative. Return `('', pattern)`.
- Meta-char after a separator at index 0 (Unix): `baseDir = '/'`.
- Windows drive root (`C:/*.txt`): if `baseDir` is `'C:'`, append the platform separator to make it the drive root rather than "current dir on drive C".

### 2.7 Render

```ts
mapToolResultToToolResultBlockParam(out, id) {
  if (out.filenames.length === 0)
    return { tool_use_id: id, type: 'tool_result', content: 'No files found' }

  return {
    tool_use_id: id, type: 'tool_result',
    content: [
      ...out.filenames,
      ...(out.truncated
        ? ['(Results are truncated. Consider using a more specific path or pattern.)']
        : []),
    ].join('\n')
  }
}

extractSearchText(out) { return out.filenames.join('\n') }
```

---

## 3. Search tool (Grep)

### 3.1 Name, prompt

- **Name:** `Grep`
- **userFacingName:** `"Search"`
- **maxResultSizeChars:** `20_000` (the harness's persistence threshold)
- **searchHint:** `"search file contents with regex (ripgrep)"`
- **strict:** `true` (no extra fields tolerated)

Description:

```
A powerful search tool built on ripgrep

  Usage:
  - ALWAYS use Grep for search tasks. NEVER invoke `grep` or `rg` as a Bash command.
    The Grep tool has been optimized for correct permissions and access.
  - Supports full regex syntax (e.g., "log.*Error", "function\s+\w+")
  - Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter
    (e.g., "js", "py", "rust")
  - Output modes: "content" shows matching lines, "files_with_matches" shows only
    file paths (default), "count" shows match counts
  - Use Agent tool for open-ended searches requiring multiple rounds
  - Pattern syntax: Uses ripgrep (not grep) — literal braces need escaping
    (use `interface\{\}` to find `interface{}` in Go code)
  - Multiline matching: By default patterns match within single lines only. For
    cross-line patterns like `struct \{[\s\S]*?field`, use `multiline: true`
```

### 3.2 Input schema

```ts
{
  pattern:      string,                                        // regex, required
  path?:        string,                                         // file or dir; default cwd
  glob?:        string,                                         // file filter, e.g. "*.{ts,tsx}"
  output_mode?: 'content' | 'files_with_matches' | 'count',     // default: files_with_matches
  '-B'?:        number,    // lines before each match; content-mode only
  '-A'?:        number,    // lines after each match;  content-mode only
  '-C'?:        number,    // alias for `context`
  context?:     number,    // before AND after; content-mode only
  '-n'?:        boolean,   // show line numbers; content-mode only; default true
  '-i'?:        boolean,   // case-insensitive
  type?:        string,    // ripgrep --type, e.g. "js", "py", "rust"
  head_limit?:  number,    // limit results; default 250; 0 = unlimited
  offset?:      number,    // skip N results before applying head_limit; default 0
  multiline?:   boolean,   // enable -U --multiline-dotall; default false
}
```

Behavior notes:

- `output_mode` default is `files_with_matches`. The model usually wants paths; content mode burns tokens fast.
- Context flags only apply to `output_mode: 'content'` and are silently ignored otherwise.
- `'-n'` defaults to `true` for content mode.
- When `pattern` starts with `-`, ripgrep would treat it as a flag. Pass it as `-e <pattern>` instead.
- `head_limit` precedence:
  - `0` → unlimited (escape hatch)
  - `undefined` → `DEFAULT_HEAD_LIMIT = 250`
  - any positive integer → that limit

  Always also report `appliedLimit` only when truncation actually occurred — that signals the model to paginate with `offset`.

### 3.3 Output schema

```ts
{
  mode:           'content' | 'files_with_matches' | 'count',
  numFiles:       number,
  filenames:      string[],     // empty in content/count modes
  content?:       string,       // present in content/count modes
  numLines?:      number,       // content mode
  numMatches?:    number,       // count mode
  appliedLimit?:  number,       // only when truncation happened
  appliedOffset?: number,       // only when offset > 0
}
```

### 3.4 validateInput

If `path` is provided, `expandPath` and `stat()` it. ENOENT → `errorCode: 1`, message:

```
Path does not exist: {path}. Note: your current working directory is {cwd}. Did you mean {suggestion}?
```

Note Grep accepts a *file* path too — don't reject non-directories.

### 3.5 Executor

The base ripgrep argv:

```ts
const args = [
  '--hidden',
  '--glob', '!.git', '--glob', '!.svn', '--glob', '!.hg',
  '--glob', '!.bzr', '--glob', '!.jj',  '--glob', '!.sl',
  '--max-columns', '500',                // truncate long lines (defends against minified/base64 spam)
]

if (multiline)         args.push('-U', '--multiline-dotall')
if (case_insensitive)  args.push('-i')

if (output_mode === 'files_with_matches') args.push('-l')
else if (output_mode === 'count')         args.push('-c')

if (output_mode === 'content' && show_line_numbers)
  args.push('-n')

// Context: -C/context wins over (-B, -A) pair; ignored outside content mode.
if (output_mode === 'content') {
  if      (context   !== undefined) args.push('-C', String(context))
  else if (context_c !== undefined) args.push('-C', String(context_c))
  else {
    if (context_before !== undefined) args.push('-B', String(context_before))
    if (context_after  !== undefined) args.push('-A', String(context_after))
  }
}

if (pattern.startsWith('-')) args.push('-e', pattern)
else                          args.push(pattern)

if (type) args.push('--type', type)
```

`glob` parameter parsing — split on whitespace **and** comma, but preserve `{a,b}` brace expansions:

```ts
if (glob) {
  const result: string[] = []
  for (const raw of glob.split(/\s+/)) {
    if (raw.includes('{') && raw.includes('}')) result.push(raw)
    else                                          result.push(...raw.split(',').filter(Boolean))
  }
  for (const g of result.filter(Boolean)) args.push('--glob', g)
}
```

User ignore patterns:

```ts
for (const p of ignorePatterns) {
  // ripgrep applies gitignore patterns relative to the working dir, so prefix
  // non-absolute patterns with **/ to match anywhere. Negate with `!` to exclude.
  // Reference: https://github.com/BurntSushi/ripgrep/discussions/2156#discussioncomment-2316335
  const rgPat = p.startsWith('/') ? `!${p}` : `!**/${p}`
  args.push('--glob', rgPat)
}
```

Then run `await ripGrep(args, absolutePath, abortSignal)` and post-process per output mode.

#### Content mode

`results` is an array of lines from ripgrep, each shaped `/abs/path:line` or `/abs/path:N:line`. Apply head_limit / offset *before* relativizing (saves work):

```ts
const { items, appliedLimit } = applyHeadLimit(results, head_limit, offset)
const finalLines = items.map(line => {
  const i = line.indexOf(':')
  return i > 0 ? toRelativePath(line.slice(0, i)) + line.slice(i) : line
})
return { data: {
  mode: 'content', numFiles: 0, filenames: [],
  content: finalLines.join('\n'),
  numLines: finalLines.length,
  ...(appliedLimit !== undefined && { appliedLimit }),
  ...(offset > 0 && { appliedOffset: offset }),
}}
```

#### Count mode

Lines are `/abs/path:N`. Same head_limit + relativize sequence; in addition compute total matches and file count:

```ts
let totalMatches = 0, fileCount = 0
for (const line of finalLines) {
  const i = line.lastIndexOf(':')
  if (i > 0) {
    const n = parseInt(line.slice(i + 1), 10)
    if (!isNaN(n)) { totalMatches += n; fileCount += 1 }
  }
}
```

Return `{mode: 'count', numFiles: fileCount, filenames: [], content: lines.join('\n'), numMatches: totalMatches, ...}`.

#### files_with_matches mode

`results` is just absolute paths. Sort by mtime descending (most-recent first), filename as tiebreaker. Use `Promise.allSettled` for the `stat()` calls so a single ENOENT (file deleted between rg's scan and stat) doesn't reject the whole batch — failed stats sort as mtime 0. In tests, sort by filename only for determinism.

```ts
const stats = await Promise.allSettled(results.map(p => fs.stat(p)))
const sorted = results
  .map((p, i) => [p, stats[i].status === 'fulfilled' ? stats[i].value.mtimeMs ?? 0 : 0] as const)
  .sort((a, b) => process.env.NODE_ENV === 'test'
                    ? a[0].localeCompare(b[0])
                    : (b[1] - a[1]) || a[0].localeCompare(b[0]))
  .map(_ => _[0])

const { items, appliedLimit } = applyHeadLimit(sorted, head_limit, offset)
return { data: {
  mode: 'files_with_matches',
  filenames: items.map(toRelativePath),
  numFiles: items.length,
  ...(appliedLimit !== undefined && { appliedLimit }),
  ...(offset > 0 && { appliedOffset: offset }),
}}
```

#### `applyHeadLimit`

```ts
const DEFAULT_HEAD_LIMIT = 250
function applyHeadLimit<T>(items: T[], limit: number | undefined, offset = 0) {
  if (limit === 0) return { items: items.slice(offset), appliedLimit: undefined }
  const eff = limit ?? DEFAULT_HEAD_LIMIT
  const sliced = items.slice(offset, offset + eff)
  const truncated = items.length - offset > eff
  return { items: sliced, appliedLimit: truncated ? eff : undefined }
}
```

Only emit `appliedLimit` in the result when truncation actually occurred — otherwise the `[Showing results with pagination = limit: 250]` footer is misleading.

### 3.6 Render

```ts
function formatLimitInfo(limit, offset) {
  const parts = []
  if (limit  !== undefined) parts.push(`limit: ${limit}`)
  if (offset)               parts.push(`offset: ${offset}`)
  return parts.join(', ')
}

mapToolResultToToolResultBlockParam(out, id) {
  const info = formatLimitInfo(out.appliedLimit, out.appliedOffset)

  if (out.mode === 'content') {
    const body = out.content || 'No matches found'
    const tail = info ? `\n\n[Showing results with pagination = ${info}]` : ''
    return { tool_use_id: id, type: 'tool_result', content: body + tail }
  }

  if (out.mode === 'count') {
    const body = out.content || 'No matches found'
    const m = out.numMatches ?? 0, f = out.numFiles ?? 0
    const summary =
      `\n\nFound ${m} total ${m === 1 ? 'occurrence' : 'occurrences'} ` +
      `across ${f} ${f === 1 ? 'file' : 'files'}.` +
      (info ? ` with pagination = ${info}` : '')
    return { tool_use_id: id, type: 'tool_result', content: body + summary }
  }

  // files_with_matches
  if (out.numFiles === 0)
    return { tool_use_id: id, type: 'tool_result', content: 'No files found' }
  const header = `Found ${out.numFiles} ${plural(out.numFiles, 'file')}` + (info ? ` ${info}` : '')
  return {
    tool_use_id: id, type: 'tool_result',
    content: `${header}\n${out.filenames.join('\n')}`,
  }
}

extractSearchText(out) {
  if (out.mode === 'content' && out.content) return out.content
  return out.filenames.join('\n')
}
```

---

## 4. Ripgrep wrapper

Both Find and Search depend on a common `ripGrep(args, target, abortSignal) → string[]` helper. Specifying it carefully matters: a chatty session can fire dozens of search calls per minute and their reliability dominates UX.

### 4.1 Locating the binary

Three modes, in priority order:

1. **System ripgrep.** If env `USE_BUILTIN_RIPGREP` is explicitly falsy (`0`/`false`), look up `rg` on `PATH`. **Spawn it as `'rg'`, not as the resolved absolute path** — using the absolute path defeats the OS's `NoDefaultCurrentDirectoryInExePath` protection on Windows and lets a malicious `./rg.exe` in cwd hijack the call.
2. **Embedded.** If you ship in a single bundled binary that contains ripgrep statically (Bun-style busybox), spawn yourself with `argv0 = 'rg'`.
3. **Vendored.** Fall back to a vendored binary at `<install_dir>/vendor/ripgrep/<arch>-<platform>/rg[.exe]`.

On macOS, vendored ripgrep arrives "linker-signed" and macOS will refuse to execute it. On first use, run `codesign --sign - --force --preserve-metadata=entitlements,requirements,flags,runtime <path>` and `xattr -d com.apple.quarantine <path>`. Skip if `codesign -vv -d <path>` doesn't show `linker-signed`.

### 4.2 Spawning

- `MAX_BUFFER_SIZE = 20_000_000` (20 MB stdout cap; 200k+ files in big monorepos easily exceed default 1 MB).
- Default timeout: 20 s on most platforms, 60 s on WSL (severe FS perf penalty). Override via `CLAUDE_CODE_GLOB_TIMEOUT_SECONDS` env (seconds).
- `windowsHide: true` so a console window doesn't flash.
- Pass the AbortSignal so the caller can cancel.
- Use `SIGKILL` as `killSignal` — ripgrep can be blocked in uninterruptible filesystem I/O and ignore SIGTERM. On Windows, leave the kill signal default (Windows can't deliver SIGKILL).
- For embedded mode (where you need `argv0`), use `spawn` and implement the timeout yourself: SIGTERM after the timeout, then escalate to SIGKILL after another 5 s if it didn't die.
- Guard against the Windows quirk where both `'close'` and `'error'` fire for the same process when an AbortSignal kills it — keep a `settled` flag and ignore the second event.

### 4.3 Error/exit-code handling

Ripgrep exit codes: `0` = matches, `1` = no matches (both **success**), `2` = usage error, others = runtime failures.

```ts
if (error == null)              resolve(parse(stdout))   // success
else if (error.code === 1)      resolve([])              // no matches — not an error
else if (error.code in {ENOENT,EACCES,EPERM}) reject(error)   // ripgrep not runnable

// EAGAIN retry: in resource-constrained environments (Docker, CI), rg can fail
// to spawn its threads. Retry ONCE with `-j 1` (single-threaded). Don't make
// that sticky — it slows future calls on large repos.
else if (!isRetry && stderr.includes('os error 11')) {
  retry with `-j 1` flag
}

else {
  // Try to salvage partial results.
  const isTimeout = error.signal === 'SIGTERM' || error.signal === 'SIGKILL'
                  || error.code === 'ABORT_ERR'
  const isOverflow = error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'

  let lines = parse(stdout)
  // The last line may be torn for timeouts/overflow — drop it.
  if (lines.length && (isTimeout || isOverflow)) lines = lines.slice(0, -1)

  // If we timed out with NO results, surface a real error so the model knows
  // the search didn't complete (instead of treating empty output as "no match").
  if (isTimeout && lines.length === 0) {
    throw new RipgrepTimeoutError(
      `Ripgrep search timed out after ${platform === 'wsl' ? 60 : 20} seconds. ` +
      `The search may have matched files but did not complete in time. ` +
      `Try searching a more specific path or pattern.`,
      lines,
    )
  }
  resolve(lines)
}
```

`RipgrepTimeoutError` carries `partialResults: string[]` so callers can choose to use what was returned.

### 4.4 Parsing

```ts
stdout.trim().split('\n').map(l => l.replace(/\r$/, '')).filter(Boolean)
```

Strip CR for CRLF outputs (Windows). Drop empty lines (final trailing newline).

### 4.5 Optional streaming variant (`ripGrepStream`)

For interactive UIs that paint results as they arrive: spawn rg, on each `'data'` chunk split on `\n` (carrying a `remainder` across chunks), call `onLines(lines)`. Strip trailing `\r`. On `'close'` flush the final remainder *only if not aborted* — flushing after an abort can deliver a torn tail.

---

## 5. Failure modes you must handle

| Symptom | Cause | Handling |
|---------|-------|----------|
| `ENOENT` from Read | File missing or rename | Try macOS thin-space alt; then suggest similar file via cwd search + Levenshtein |
| `EISDIR` from Read | Path is a directory | Throw with the standard message; suggest Bash `ls` |
| File too large | `stats.size > maxSizeBytes` and no `limit` | Throw `FileTooLargeError` pre-read |
| Token cap exceeded | Output > `maxTokens` | Throw `MaxFileReadTokenExceededError` post-read |
| ripgrep `EAGAIN` | Thread spawn failure under resource pressure | Retry once with `-j 1`, don't persist |
| ripgrep timeout | Slow FS / huge repo | Trim torn last line; throw `RipgrepTimeoutError` if zero results |
| ripgrep stdout > 20 MB | Over-broad search (e.g. all files in monorepo) | `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`; same trim-and-return path as timeout |
| UNC path | `\\server\share\...` | Skip stat in validation, let read fail naturally; never silently `stat()` |
| Device file | `/dev/zero`, `/dev/tty`, etc. | Reject in `validateInput` before any I/O |
| Binary file passed to Read | `.zip`, `.so`, etc. | Reject by extension in `validateInput` |
| Empty file | `totalLines === 0` | Render the empty-file `<system-reminder>` instead of empty content |
| Offset past EOF | `startLine > totalLines` | Render the `is shorter than the provided offset` `<system-reminder>` |
| Image too large in tokens | `base64 * 0.125 > maxTokens` | Aggressive compress; final fallback 400×400 q20 JPEG |
| PDF too long | `pageCount > 10` and no `pages` | Throw with instruction to use `pages:` |
| poppler missing | `extractPDFPages` unavailable, model can't read PDF natively | Throw with install instructions |
| Malicious pattern with leading `-` | rg interprets as flag | Use `-e <pattern>` |
| Multiline regex | `.` doesn't cross `\n` by default in rg | Require `multiline: true` to add `-U --multiline-dotall` |

---

## 6. Sanity test checklist

Before you ship, verify these by hand (or in tests):

1. `Read` of a 5-line file with no `offset/limit` returns all 5 lines, line-numbered from 1, with the cyber-risk `<system-reminder>` appended.
2. `Read` of the same file twice in a row returns `file_unchanged` on the second call. `touch` the file between calls; the second call now returns full content.
3. `Read` of a 1 GB log file with `offset: 1, limit: 10` returns 10 lines without OOM (streaming path).
4. `Read` of a `.png` returns an image block, not text. `Read` of a `.zip` is rejected pre-I/O.
5. `Read` of `/dev/tty` is rejected pre-I/O. `Read` of `/dev/null` succeeds (returns empty-file reminder).
6. `Read` of a UNC path on Windows does not stat during validation.
7. `Read` of a path with a typo returns "Did you mean …?" pointing at the closest cwd match.
8. `Glob` of `**/*.ts` returns paths sorted oldest-first (rg `--sort=modified`), then your post-relativization preserves order.
9. `Glob` over a 200k-file monorepo doesn't OOM; the 100-file limit truncates and `truncated: true` is set.
10. `Grep` for `pattern.*foo` with `output_mode: 'content', -C: 2` returns lines with 2 lines of context, line-numbered, sorted by ripgrep's natural file order.
11. `Grep` for `^class\b` in `files_with_matches` mode returns paths sorted by mtime desc, with `head_limit` defaulting to 250 and `appliedLimit` only set when truncated.
12. `Grep` with a pattern starting with `-`: `pattern: "-Wall"` — search succeeds (uses `-e`).
13. `Grep` with `multiline: true` and `pattern: "struct \\{[\\s\\S]*?field"` matches across newlines.
14. Killing the AbortSignal mid-search aborts ripgrep within milliseconds and Glob/Grep reject without leaving a zombie process.
15. With ripgrep removed from `PATH` and `USE_BUILTIN_RIPGREP=0`, both tools fall back to the vendored binary (or, on macOS, run codesign once and continue).

If those 15 work, you have parity with the reference implementation.
