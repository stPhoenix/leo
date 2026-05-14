import { promises as fs, type Dirent } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { Minimatch } from 'minimatch';
import {
  readFileInputSchema,
  writeFileInputSchema,
  listDirInputSchema,
  deleteFileInputSchema,
  appendFileInputSchema,
  grepInputSchema,
  globInputSchema,
  downloadToFileInputSchema,
  GREP_DEFAULT_MAX_MATCHES,
  GLOB_DEFAULT_MAX_RESULTS,
  type ReadFileInput,
  type WriteFileInput,
  type AppendFileInput,
  type GrepInput,
  type GlobInput,
  type DownloadToFileInput,
} from './schemas';
import type { FetchUrlTool } from './fetchUrl';
import type { Sandbox } from '../sandbox';
import type { InlineAgentLoggerLite } from '../eventBridge';

export const READ_FILE_DEFAULT_MAX_BYTES = 1 * 1024 * 1024;

export interface FileOpsCtx {
  readonly sandbox: Sandbox;
  readonly signal: AbortSignal;
  readonly logger: InlineAgentLoggerLite;
  readonly readMaxBytes?: number;
}

export type ReadFileResult =
  | {
      readonly ok: true;
      readonly data: {
        readonly content: string;
        readonly encoding: 'utf-8' | 'base64';
        readonly bytesRead: number;
        readonly eof: boolean;
      };
    }
  | {
      readonly ok: false;
      readonly error:
        | 'path_outside_sandbox'
        | 'not_found'
        | 'too_large'
        | 'is_directory'
        | 'invalid_args'
        | 'io_error';
    };

export type WriteFileResult =
  | {
      readonly ok: true;
      readonly data: { readonly bytesWritten: number; readonly sandboxBytes: number };
    }
  | {
      readonly ok: false;
      readonly error: 'path_outside_sandbox' | 'quota_exceeded' | 'invalid_args' | 'io_error';
    };

export interface ListDirEntry {
  readonly name: string;
  readonly type: 'file' | 'dir';
  readonly bytes?: number;
}

export type ListDirResult =
  | { readonly ok: true; readonly data: { readonly entries: readonly ListDirEntry[] } }
  | {
      readonly ok: false;
      readonly error: 'path_outside_sandbox' | 'not_found' | 'not_directory' | 'invalid_args';
    };

export type DeleteFileResult =
  | { readonly ok: true; readonly data: { readonly deleted: true } }
  | {
      readonly ok: false;
      readonly error:
        | 'path_outside_sandbox'
        | 'not_found'
        | 'not_empty'
        | 'invalid_args'
        | 'io_error';
    };

export type AppendFileResult =
  | {
      readonly ok: true;
      readonly data: { readonly bytesAppended: number; readonly sandboxBytes: number };
    }
  | {
      readonly ok: false;
      readonly error:
        | 'path_outside_sandbox'
        | 'is_directory'
        | 'quota_exceeded'
        | 'invalid_args'
        | 'io_error';
    };

export interface GrepMatch {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export type GrepResult =
  | {
      readonly ok: true;
      readonly data: {
        readonly matches: readonly GrepMatch[];
        readonly truncated: boolean;
        readonly filesScanned: number;
      };
    }
  | {
      readonly ok: false;
      readonly error: 'path_outside_sandbox' | 'not_found' | 'invalid_pattern' | 'invalid_args';
    };

export type GlobResult =
  | {
      readonly ok: true;
      readonly data: { readonly paths: readonly string[]; readonly truncated: boolean };
    }
  | {
      readonly ok: false;
      readonly error: 'invalid_pattern' | 'invalid_args';
    };

export interface ReadFileTool {
  readonly name: 'read_file';
  invoke(input: unknown): Promise<ReadFileResult>;
}
export interface WriteFileTool {
  readonly name: 'write_file';
  invoke(input: unknown): Promise<WriteFileResult>;
}
export interface ListDirTool {
  readonly name: 'list_dir';
  invoke(input: unknown): Promise<ListDirResult>;
}
export interface DeleteFileTool {
  readonly name: 'delete_file';
  invoke(input: unknown): Promise<DeleteFileResult>;
}
export interface AppendFileTool {
  readonly name: 'append_file';
  invoke(input: unknown): Promise<AppendFileResult>;
}
export interface GrepTool {
  readonly name: 'grep';
  invoke(input: unknown): Promise<GrepResult>;
}
export interface GlobTool {
  readonly name: 'glob';
  invoke(input: unknown): Promise<GlobResult>;
}

export type DownloadToFileResult =
  | {
      readonly ok: true;
      readonly data: {
        readonly relPath: string;
        readonly bytesWritten: number;
        readonly status: number;
        readonly url: string;
        readonly truncated: boolean;
        readonly sandboxBytes: number;
      };
    }
  | {
      readonly ok: false;
      readonly error:
        | 'invalid_args'
        | 'path_outside_sandbox'
        | 'quota_exceeded'
        | 'io_error'
        | 'fetch_failed';
      readonly fetchError?: string;
      readonly status?: number;
    };

export interface DownloadToFileTool {
  readonly name: 'download_to_file';
  invoke(input: unknown): Promise<DownloadToFileResult>;
}

export function createReadFileTool(ctx: FileOpsCtx): ReadFileTool {
  const maxBytes = ctx.readMaxBytes ?? READ_FILE_DEFAULT_MAX_BYTES;
  return {
    name: 'read_file',
    async invoke(input): Promise<ReadFileResult> {
      let parsed: ReadFileInput;
      try {
        parsed = readFileInputSchema.parse(input);
      } catch {
        return { ok: false, error: 'invalid_args' };
      }
      const resolved = ctx.sandbox.resolve(parsed.relPath);
      if (!resolved.ok) return { ok: false, error: 'path_outside_sandbox' };
      const safe = await ctx.sandbox.checkSafe(resolved.absPath);
      if (!safe.ok) {
        if (safe.error === 'not_found') return { ok: false, error: 'not_found' };
        return { ok: false, error: 'path_outside_sandbox' };
      }
      let stat;
      try {
        stat = await fs.stat(resolved.absPath);
      } catch (err) {
        if (errorCode(err) === 'ENOENT') return { ok: false, error: 'not_found' };
        return { ok: false, error: 'io_error' };
      }
      if (stat.isDirectory()) return { ok: false, error: 'is_directory' };
      const totalSize = stat.size;
      const offset = parsed.offset ?? 0;
      const limit = parsed.limit ?? maxBytes;
      if (limit > maxBytes) return { ok: false, error: 'too_large' };
      const requested = Math.min(limit, Math.max(0, totalSize - offset));
      let buf: Buffer;
      try {
        const handle = await fs.open(resolved.absPath, 'r');
        try {
          const out = Buffer.alloc(requested);
          const { bytesRead } = await handle.read(out, 0, requested, offset);
          buf = out.slice(0, bytesRead);
        } finally {
          await handle.close();
        }
      } catch (err) {
        if (errorCode(err) === 'ENOENT') return { ok: false, error: 'not_found' };
        return { ok: false, error: 'io_error' };
      }
      const isBinary = looksBinary(buf);
      const encoding: 'utf-8' | 'base64' = isBinary ? 'base64' : 'utf-8';
      const content = isBinary ? buf.toString('base64') : buf.toString('utf8');
      const eof = offset + buf.length >= totalSize;
      return {
        ok: true,
        data: { content, encoding, bytesRead: buf.length, eof },
      };
    },
  };
}

export function createWriteFileTool(ctx: FileOpsCtx): WriteFileTool {
  return {
    name: 'write_file',
    async invoke(input): Promise<WriteFileResult> {
      let parsed: WriteFileInput;
      try {
        parsed = writeFileInputSchema.parse(input);
      } catch {
        return { ok: false, error: 'invalid_args' };
      }
      const resolved = ctx.sandbox.resolve(parsed.relPath);
      if (!resolved.ok) return { ok: false, error: 'path_outside_sandbox' };
      const safe = await ctx.sandbox.checkSafe(resolved.absPath);
      if (!safe.ok && safe.error !== 'not_found') {
        return { ok: false, error: 'path_outside_sandbox' };
      }
      const encoding = parsed.encoding ?? 'utf-8';
      const buf =
        encoding === 'base64'
          ? Buffer.from(parsed.content, 'base64')
          : Buffer.from(parsed.content, 'utf8');

      let existingBytes = 0;
      try {
        const stat = await fs.stat(resolved.absPath);
        existingBytes = stat.isFile() ? stat.size : 0;
      } catch (err) {
        if (errorCode(err) !== 'ENOENT') return { ok: false, error: 'io_error' };
      }

      const delta = buf.byteLength - existingBytes;
      if (delta > 0 && ctx.sandbox.willExceedQuota(delta)) {
        return { ok: false, error: 'quota_exceeded' };
      }

      try {
        await fs.mkdir(dirname(resolved.absPath), { recursive: true });
        await fs.writeFile(resolved.absPath, buf);
      } catch {
        return { ok: false, error: 'io_error' };
      }

      ctx.sandbox.addBytes(delta);
      return {
        ok: true,
        data: { bytesWritten: buf.byteLength, sandboxBytes: ctx.sandbox.bytes() },
      };
    },
  };
}

export function createListDirTool(ctx: FileOpsCtx): ListDirTool {
  return {
    name: 'list_dir',
    async invoke(input): Promise<ListDirResult> {
      const parsedResult = parseToolInput(input, listDirInputSchema);
      if (!parsedResult.ok) return { ok: false, error: 'invalid_args' };
      const rel = parsedResult.data.relPath ?? '';
      const checked = await resolveAndCheck(ctx, rel);
      if (!checked.ok) {
        return checked.error === 'not_found'
          ? { ok: false, error: 'not_found' }
          : { ok: false, error: 'path_outside_sandbox' };
      }
      let entries: Dirent[];
      try {
        entries = await fs.readdir(checked.absPath, { withFileTypes: true });
      } catch (err) {
        return mapReaddirError(err);
      }
      return { ok: true, data: { entries: await collectDirEntries(checked.absPath, entries) } };
    },
  };
}

function mapReaddirError(err: unknown): ListDirResult {
  const code = errorCode(err);
  if (code === 'ENOENT') return { ok: false, error: 'not_found' };
  if (code === 'ENOTDIR') return { ok: false, error: 'not_directory' };
  return { ok: false, error: 'path_outside_sandbox' };
}

async function collectDirEntries(absDir: string, entries: Dirent[]): Promise<ListDirEntry[]> {
  const out: ListDirEntry[] = [];
  for (const e of entries) {
    if (e.isFile()) {
      let bytes = 0;
      try {
        const s = await fs.stat(absDir + '/' + e.name);
        bytes = s.size;
      } catch {
        /* ignore */
      }
      out.push({ name: e.name, type: 'file', bytes });
    } else if (e.isDirectory()) {
      out.push({ name: e.name, type: 'dir' });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function parseToolInput<T>(
  input: unknown,
  schema: { parse: (i: unknown) => T },
): { ok: true; data: T } | { ok: false } {
  try {
    return { ok: true, data: schema.parse(input) };
  } catch {
    return { ok: false };
  }
}

async function resolveAndCheck(
  ctx: FileOpsCtx,
  rel: string,
): Promise<{ ok: true; absPath: string } | { ok: false; error: 'not_found' | 'outside' }> {
  const resolved = ctx.sandbox.resolve(rel);
  if (!resolved.ok) return { ok: false, error: 'outside' };
  const safe = await ctx.sandbox.checkSafe(resolved.absPath);
  if (!safe.ok) return { ok: false, error: safe.error === 'not_found' ? 'not_found' : 'outside' };
  return { ok: true, absPath: resolved.absPath };
}

export function createDeleteFileTool(ctx: FileOpsCtx): DeleteFileTool {
  return {
    name: 'delete_file',
    async invoke(input): Promise<DeleteFileResult> {
      const parsedResult = parseToolInput(input, deleteFileInputSchema);
      if (!parsedResult.ok) return { ok: false, error: 'invalid_args' };
      const parsed = parsedResult.data;
      const resolved = ctx.sandbox.resolve(parsed.relPath);
      if (!resolved.ok) return { ok: false, error: 'path_outside_sandbox' };
      if (resolved.absPath === ctx.sandbox.root) {
        return { ok: false, error: 'path_outside_sandbox' };
      }
      const safe = await ctx.sandbox.checkSafe(resolved.absPath);
      if (!safe.ok) {
        return safe.error === 'not_found'
          ? { ok: false, error: 'not_found' }
          : { ok: false, error: 'path_outside_sandbox' };
      }
      return performDelete(ctx, resolved.absPath);
    },
  };
}

async function performDelete(ctx: FileOpsCtx, absPath: string): Promise<DeleteFileResult> {
  let stat;
  try {
    stat = await fs.stat(absPath);
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return { ok: false, error: 'not_found' };
    return { ok: false, error: 'io_error' };
  }
  try {
    if (stat.isDirectory()) {
      const entries = await fs.readdir(absPath);
      if (entries.length > 0) return { ok: false, error: 'not_empty' };
      await fs.rmdir(absPath);
    } else {
      await fs.unlink(absPath);
      ctx.sandbox.addBytes(-stat.size);
    }
  } catch (err) {
    const code = errorCode(err);
    if (code === 'ENOENT') return { ok: false, error: 'not_found' };
    return { ok: false, error: 'io_error' };
  }
  return { ok: true, data: { deleted: true } };
}

export function createAppendFileTool(ctx: FileOpsCtx): AppendFileTool {
  return {
    name: 'append_file',
    async invoke(input): Promise<AppendFileResult> {
      let parsed: AppendFileInput;
      try {
        parsed = appendFileInputSchema.parse(input);
      } catch {
        return { ok: false, error: 'invalid_args' };
      }
      const resolved = ctx.sandbox.resolve(parsed.relPath);
      if (!resolved.ok) return { ok: false, error: 'path_outside_sandbox' };
      const safe = await ctx.sandbox.checkSafe(resolved.absPath);
      if (!safe.ok && safe.error !== 'not_found') {
        return { ok: false, error: 'path_outside_sandbox' };
      }
      const encoding = parsed.encoding ?? 'utf-8';
      const buf =
        encoding === 'base64'
          ? Buffer.from(parsed.content, 'base64')
          : Buffer.from(parsed.content, 'utf8');

      try {
        const stat = await fs.stat(resolved.absPath);
        if (stat.isDirectory()) return { ok: false, error: 'is_directory' };
      } catch (err) {
        if (errorCode(err) !== 'ENOENT') return { ok: false, error: 'io_error' };
      }

      if (ctx.sandbox.willExceedQuota(buf.byteLength)) {
        return { ok: false, error: 'quota_exceeded' };
      }
      try {
        await fs.mkdir(dirname(resolved.absPath), { recursive: true });
        await fs.appendFile(resolved.absPath, buf);
      } catch {
        return { ok: false, error: 'io_error' };
      }
      ctx.sandbox.addBytes(buf.byteLength);
      return {
        ok: true,
        data: { bytesAppended: buf.byteLength, sandboxBytes: ctx.sandbox.bytes() },
      };
    },
  };
}

async function* walkSandboxFiles(root: string, start: string): AsyncIterable<string> {
  const stack: string[] = [start];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    const entries = await safeReaddir(dir);
    if (entries === null) continue;
    for (const entry of entries) {
      const yielded = handleWalkEntry(root, dir, entry, stack);
      if (yielded !== null) yield yielded;
    }
  }
}

async function safeReaddir(dir: string): Promise<Dirent[] | null> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

function handleWalkEntry(root: string, dir: string, entry: Dirent, stack: string[]): string | null {
  if (entry.isSymbolicLink()) return null;
  const child = join(dir, entry.name);
  if (entry.isDirectory()) {
    if (child === root || child.startsWith(root + sep)) stack.push(child);
    return null;
  }
  return entry.isFile() ? child : null;
}

function buildGrepMatcher(
  parsed: GrepInput,
): { ok: true; matcher: (line: string) => boolean } | { ok: false; error: 'invalid_pattern' } {
  if (parsed.regex === true) {
    let re: RegExp;
    try {
      re = new RegExp(parsed.pattern, parsed.ignoreCase === true ? 'i' : '');
    } catch {
      return { ok: false, error: 'invalid_pattern' };
    }
    return { ok: true, matcher: (line) => re.test(line) };
  }
  const needle = parsed.ignoreCase === true ? parsed.pattern.toLowerCase() : parsed.pattern;
  const matcher = (line: string): boolean =>
    (parsed.ignoreCase === true ? line.toLowerCase() : line).includes(needle);
  return { ok: true, matcher };
}

function scanFileForMatches(
  abs: string,
  raw: Buffer,
  sandboxRoot: string,
  matcher: (line: string) => boolean,
  max: number,
  matches: GrepMatch[],
): boolean {
  const text = raw.toString('utf8');
  const lines = text.split(/\r?\n/);
  const relPath = relative(sandboxRoot, abs).split(sep).join('/');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (matcher(line)) {
      matches.push({ path: relPath, line: i + 1, text: line.slice(0, 500) });
      if (matches.length >= max) return true;
    }
  }
  return false;
}

export function createGrepTool(ctx: FileOpsCtx): GrepTool {
  return {
    name: 'grep',
    async invoke(input): Promise<GrepResult> {
      const parsedResult = parseToolInput(input, grepInputSchema);
      if (!parsedResult.ok) return { ok: false, error: 'invalid_args' };
      const parsed = parsedResult.data;
      const checked = await resolveAndCheck(ctx, parsed.relPath ?? '');
      if (!checked.ok) {
        return checked.error === 'not_found'
          ? { ok: false, error: 'not_found' }
          : { ok: false, error: 'path_outside_sandbox' };
      }
      const matcherResult = buildGrepMatcher(parsed);
      if (!matcherResult.ok) return { ok: false, error: matcherResult.error };
      const max = parsed.maxMatches ?? GREP_DEFAULT_MAX_MATCHES;

      const fileIter = await openGrepIterator(ctx, checked.absPath);
      if (!fileIter.ok) return fileIter.error;
      return scanGrep(ctx, fileIter.iter, matcherResult.matcher, max);
    },
  };
}

async function openGrepIterator(
  ctx: FileOpsCtx,
  absPath: string,
): Promise<
  | { ok: true; iter: AsyncIterable<string> }
  | { ok: false; error: { ok: false; error: 'not_found' | 'path_outside_sandbox' } }
> {
  try {
    const stat = await fs.stat(absPath);
    const iter: AsyncIterable<string> = stat.isFile()
      ? (async function* (): AsyncIterable<string> {
          yield absPath;
        })()
      : walkSandboxFiles(ctx.sandbox.root, absPath);
    return { ok: true, iter };
  } catch (err) {
    if (errorCode(err) === 'ENOENT') {
      return { ok: false, error: { ok: false, error: 'not_found' } };
    }
    return { ok: false, error: { ok: false, error: 'path_outside_sandbox' } };
  }
}

async function scanGrep(
  ctx: FileOpsCtx,
  fileIter: AsyncIterable<string>,
  matcher: (line: string) => boolean,
  max: number,
): Promise<GrepResult> {
  const matches: GrepMatch[] = [];
  let filesScanned = 0;
  let truncated = false;
  for await (const abs of fileIter) {
    if (ctx.signal.aborted) break;
    filesScanned += 1;
    let raw: Buffer;
    try {
      raw = await fs.readFile(abs);
    } catch {
      continue;
    }
    if (looksBinary(raw)) continue;
    if (scanFileForMatches(abs, raw, ctx.sandbox.root, matcher, max, matches)) {
      truncated = true;
      break;
    }
  }
  return { ok: true, data: { matches, truncated, filesScanned } };
}

export function createDownloadToFileTool(
  ctx: FileOpsCtx & { readonly fetchUrl: FetchUrlTool },
): DownloadToFileTool {
  return {
    name: 'download_to_file',
    async invoke(input): Promise<DownloadToFileResult> {
      const parsedResult = parseToolInput(input, downloadToFileInputSchema);
      if (!parsedResult.ok) return { ok: false, error: 'invalid_args' };
      const parsed = parsedResult.data;
      const resolved = ctx.sandbox.resolve(parsed.relPath);
      if (!resolved.ok) return { ok: false, error: 'path_outside_sandbox' };
      const safe = await ctx.sandbox.checkSafe(resolved.absPath);
      if (!safe.ok && safe.error !== 'not_found') {
        return { ok: false, error: 'path_outside_sandbox' };
      }

      const fetched = await downloadBodyViaFetch(ctx, parsed);
      if (!fetched.ok) return fetched.error;
      const { buf, fetchData } = fetched;

      const quotaResult = await checkQuotaForWrite(ctx, resolved.absPath, buf.byteLength);
      if (!quotaResult.ok) return quotaResult.error;
      const delta = quotaResult.delta;

      try {
        await fs.mkdir(dirname(resolved.absPath), { recursive: true });
        await fs.writeFile(resolved.absPath, buf);
      } catch {
        return { ok: false, error: 'io_error' };
      }
      ctx.sandbox.addBytes(delta);
      return {
        ok: true,
        data: {
          relPath: parsed.relPath,
          bytesWritten: buf.byteLength,
          status: fetchData.status,
          url: fetchData.url,
          truncated: fetchData.truncated === true,
          sandboxBytes: ctx.sandbox.bytes(),
        },
      };
    },
  };
}

async function downloadBodyViaFetch(
  ctx: FileOpsCtx & { readonly fetchUrl: FetchUrlTool },
  parsed: DownloadToFileInput,
): Promise<
  | { ok: true; buf: Buffer; fetchData: { status: number; url: string; truncated?: boolean } }
  | { ok: false; error: DownloadToFileResult }
> {
  const fetchInput: Record<string, unknown> = {
    url: parsed.url,
    method: parsed.method,
    responseFormat: 'text',
  };
  if (parsed.headers !== undefined) fetchInput.headers = parsed.headers;
  if (parsed.body !== undefined) fetchInput.body = parsed.body;
  const fetchResult = await ctx.fetchUrl.invoke(fetchInput);
  if (!fetchResult.ok) {
    return {
      ok: false,
      error: {
        ok: false,
        error: 'fetch_failed',
        fetchError: fetchResult.error,
        ...(fetchResult.status !== undefined ? { status: fetchResult.status } : {}),
      },
    };
  }
  const body = fetchResult.data.body;
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: true,
    buf: Buffer.from(bodyText, 'utf8'),
    fetchData: fetchResult.data,
  };
}

async function checkQuotaForWrite(
  ctx: FileOpsCtx,
  absPath: string,
  newSize: number,
): Promise<{ ok: true; delta: number } | { ok: false; error: DownloadToFileResult }> {
  let existingBytes = 0;
  try {
    const stat = await fs.stat(absPath);
    existingBytes = stat.isFile() ? stat.size : 0;
  } catch (err) {
    if (errorCode(err) !== 'ENOENT') {
      return { ok: false, error: { ok: false, error: 'io_error' } };
    }
  }
  const delta = newSize - existingBytes;
  if (delta > 0 && ctx.sandbox.willExceedQuota(delta)) {
    return { ok: false, error: { ok: false, error: 'quota_exceeded' } };
  }
  return { ok: true, delta };
}

export function createGlobTool(ctx: FileOpsCtx): GlobTool {
  return {
    name: 'glob',
    async invoke(input): Promise<GlobResult> {
      let parsed: GlobInput;
      try {
        parsed = globInputSchema.parse(input);
      } catch {
        return { ok: false, error: 'invalid_args' };
      }
      let mm: Minimatch;
      try {
        mm = new Minimatch(parsed.pattern, { dot: true, nocase: false });
      } catch {
        return { ok: false, error: 'invalid_pattern' };
      }
      const max = parsed.maxResults ?? GLOB_DEFAULT_MAX_RESULTS;
      const out: string[] = [];
      let truncated = false;
      for await (const abs of walkSandboxFiles(ctx.sandbox.root, ctx.sandbox.root)) {
        if (ctx.signal.aborted) break;
        const rel = relative(ctx.sandbox.root, abs).split(sep).join('/');
        if (mm.match(rel)) {
          out.push(rel);
          if (out.length >= max) {
            truncated = true;
            break;
          }
        }
      }
      out.sort((a, b) => a.localeCompare(b));
      return { ok: true, data: { paths: out, truncated } };
    },
  };
}

export function looksBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  const sampleSize = Math.min(buffer.length, 8 * 1024);
  let nonText = 0;
  for (let i = 0; i < sampleSize; i += 1) {
    const byte = buffer[i] ?? 0;
    if (byte === 0) return true;
    if (byte < 9) {
      nonText += 1;
      continue;
    }
    if (byte === 11 || byte === 12) {
      nonText += 1;
      continue;
    }
    if (byte > 13 && byte < 32) {
      nonText += 1;
    }
  }
  return nonText > sampleSize * 0.3;
}

function errorCode(err: unknown): string | null {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return null;
}
