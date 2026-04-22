import type { VaultAdapter } from '@/storage/vaultAdapter';
import type { ToolSpec } from './types';
import { isSafeVaultPath } from './readNoteTool';

export interface WriteArgs {
  readonly path: string;
  readonly content: string;
}

export interface WriteResult {
  readonly path: string;
  readonly bytesWritten?: number;
  readonly bytesAppended?: number;
}

function validateArgs(raw: unknown): { ok: true; data: WriteArgs } | { ok: false; error: string } {
  if (raw === null || typeof raw !== 'object')
    return { ok: false, error: 'args must be an object' };
  const obj = raw as Record<string, unknown>;
  if (typeof obj.path !== 'string' || obj.path.length === 0)
    return { ok: false, error: 'path must be a non-empty string' };
  if (typeof obj.content !== 'string') return { ok: false, error: 'content must be a string' };
  if (!isSafeVaultPath(obj.path)) return { ok: false, error: 'unsafe path' };
  return { ok: true, data: { path: obj.path, content: obj.content } };
}

function byteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  let b = 0;
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 0x80) b += 1;
    else if (c < 0x800) b += 2;
    else b += 3;
  }
  return b;
}

export function createCreateNoteTool(vault: VaultAdapter): ToolSpec<WriteArgs, WriteResult> {
  return {
    id: 'create_note',
    description:
      'Create a new markdown note at a vault-relative path with the given content. Fails if the file already exists.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative path to the new note.' },
        content: { type: 'string', description: 'Markdown content to write to the new note.' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    requiresConfirmation: true,
    source: 'builtin',
    validate: validateArgs,
    async invoke(args, ctx) {
      if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
      try {
        if (await vault.exists(args.path)) {
          return { ok: false, error: 'file exists' };
        }
        await vault.write(args.path, args.content);
        return {
          ok: true,
          data: { path: args.path, bytesWritten: byteLength(args.content) },
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

export function createAppendToNoteTool(vault: VaultAdapter): ToolSpec<WriteArgs, WriteResult> {
  return {
    id: 'append_to_note',
    description:
      'Append markdown content to an existing vault note by its vault-relative path. Fails if the file does not exist.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault-relative path to the existing note.' },
        content: {
          type: 'string',
          description:
            'Markdown content to append (a leading newline is added if the file does not end with one).',
        },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    requiresConfirmation: true,
    source: 'builtin',
    validate: validateArgs,
    async invoke(args, ctx) {
      if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
      try {
        if (!(await vault.exists(args.path))) {
          return { ok: false, error: 'not found' };
        }
        const existing = await vault.read(args.path);
        const separator = existing.endsWith('\n') || existing.length === 0 ? '' : '\n';
        const next = existing + separator + args.content;
        await vault.write(args.path, next);
        return {
          ok: true,
          data: {
            path: args.path,
            bytesAppended: byteLength(separator + args.content),
          },
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
