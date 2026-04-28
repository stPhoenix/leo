import { promises as fs, type Dirent } from 'node:fs';
import { dirname } from 'node:path';
import {
  readFileInputSchema,
  writeFileInputSchema,
  listDirInputSchema,
  deleteFileInputSchema,
  type ReadFileInput,
  type WriteFileInput,
  type ListDirInput,
  type DeleteFileInput,
} from './schemas';
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
      let parsed: ListDirInput;
      try {
        parsed = listDirInputSchema.parse(input);
      } catch {
        return { ok: false, error: 'invalid_args' };
      }
      const rel = parsed.relPath ?? '';
      const resolved = ctx.sandbox.resolve(rel);
      if (!resolved.ok) return { ok: false, error: 'path_outside_sandbox' };
      const safe = await ctx.sandbox.checkSafe(resolved.absPath);
      if (!safe.ok) {
        if (safe.error === 'not_found') return { ok: false, error: 'not_found' };
        return { ok: false, error: 'path_outside_sandbox' };
      }
      let entries: Dirent[];
      try {
        entries = await fs.readdir(resolved.absPath, { withFileTypes: true });
      } catch (err) {
        const code = errorCode(err);
        if (code === 'ENOENT') return { ok: false, error: 'not_found' };
        if (code === 'ENOTDIR') return { ok: false, error: 'not_directory' };
        return { ok: false, error: 'path_outside_sandbox' };
      }
      const out: ListDirEntry[] = [];
      for (const e of entries) {
        if (e.isFile()) {
          let bytes = 0;
          try {
            const s = await fs.stat(resolved.absPath + '/' + e.name);
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
      return { ok: true, data: { entries: out } };
    },
  };
}

export function createDeleteFileTool(ctx: FileOpsCtx): DeleteFileTool {
  return {
    name: 'delete_file',
    async invoke(input): Promise<DeleteFileResult> {
      let parsed: DeleteFileInput;
      try {
        parsed = deleteFileInputSchema.parse(input);
      } catch {
        return { ok: false, error: 'invalid_args' };
      }
      const resolved = ctx.sandbox.resolve(parsed.relPath);
      if (!resolved.ok) return { ok: false, error: 'path_outside_sandbox' };
      if (resolved.absPath === ctx.sandbox.root) {
        return { ok: false, error: 'path_outside_sandbox' };
      }
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
      try {
        if (stat.isDirectory()) {
          const entries = await fs.readdir(resolved.absPath);
          if (entries.length > 0) return { ok: false, error: 'not_empty' };
          await fs.rmdir(resolved.absPath);
        } else {
          await fs.unlink(resolved.absPath);
          ctx.sandbox.addBytes(-stat.size);
        }
      } catch (err) {
        const code = errorCode(err);
        if (code === 'ENOENT') return { ok: false, error: 'not_found' };
        return { ok: false, error: 'io_error' };
      }
      return { ok: true, data: { deleted: true } };
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
