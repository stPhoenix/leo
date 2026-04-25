import { z } from 'zod';
import type { ToolSpec } from '../types';
import { jsonSchemaFromZod, validateFromZod } from '../zodAdapter';

export interface ReadNoteArgs {
  readonly path: string;
}

export interface ReadNoteResult {
  readonly path: string;
  readonly content: string;
  readonly bytes: number;
}

const MAX_BYTES = 200 * 1024;

const ReadNoteSchema: z.ZodType<ReadNoteArgs> = z
  .object({
    path: z
      .string()
      .min(1, 'path must be a non-empty string')
      .describe('Vault-relative path to the note, e.g. "Notes/Daily.md". No "..", no leading "/".')
      .refine(isSafeVaultPath, 'path must be vault-relative and must not traverse parents'),
  })
  .strict();

export function createReadNoteTool(): ToolSpec<ReadNoteArgs, ReadNoteResult> {
  return {
    id: 'read_note',
    description:
      'Read the contents of a non-active markdown note from the vault by its vault-relative path.',
    schema: ReadNoteSchema,
    parameters: jsonSchemaFromZod(ReadNoteSchema),
    requiresConfirmation: false,
    source: 'builtin',
    validate: validateFromZod(ReadNoteSchema),
    async invoke(args, ctx) {
      if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
      try {
        if (!(await ctx.vault.exists(args.path))) {
          return { ok: false, error: `note not found: ${args.path}` };
        }
        const content = await ctx.vault.read(args.path);
        const bytes = byteLength(content);
        if (bytes > MAX_BYTES) {
          return { ok: false, error: `note too large (${bytes} bytes; limit ${MAX_BYTES})` };
        }
        return { ok: true, data: { path: args.path, content, bytes } };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
      }
    },
  };
}

export function isSafeVaultPath(p: string): boolean {
  if (p.length === 0) return false;
  if (p.startsWith('/')) return false;
  if (p.includes('..')) return false;
  if (/^[a-zA-Z]:[\\/]/.test(p)) return false;
  if (p.includes('\0')) return false;
  return true;
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
