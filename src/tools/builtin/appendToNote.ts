import { z } from 'zod';
import type { ToolSpec } from '../types';
import { isSafeVaultPath } from './readNote';
import { jsonSchemaFromZod, validateFromZod } from '../zodAdapter';

export interface AppendToNoteArgs {
  readonly path: string;
  readonly content: string;
}

export interface AppendToNoteResult {
  readonly path: string;
  readonly bytesAppended: number;
  readonly before: string;
  readonly after: string;
}

const AppendToNoteSchema: z.ZodType<AppendToNoteArgs> = z
  .object({
    path: z
      .string()
      .min(1, 'path must be a non-empty string')
      .describe('Vault-relative path to the existing note.')
      .refine(isSafeVaultPath, 'unsafe path'),
    content: z
      .string({ error: 'content must be a string' })
      .describe(
        'Markdown content to append (a leading newline is added if the file does not end with one).',
      ),
  })
  .strict();

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

export function createAppendToNoteTool(): ToolSpec<AppendToNoteArgs, AppendToNoteResult> {
  return {
    id: 'append_to_note',
    description:
      'Append markdown content to an existing vault note by its vault-relative path. Fails if the file does not exist.',
    schema: AppendToNoteSchema,
    parameters: jsonSchemaFromZod(AppendToNoteSchema),
    requiresConfirmation: true,
    source: 'builtin',
    validate: validateFromZod(AppendToNoteSchema),
    async invoke(args, ctx) {
      if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
      try {
        if (!(await ctx.vault.exists(args.path))) {
          return { ok: false, error: 'not found' };
        }
        const existing = await ctx.vault.read(args.path);
        const separator = existing.endsWith('\n') || existing.length === 0 ? '' : '\n';
        const next = existing + separator + args.content;
        await ctx.vault.write(args.path, next);
        return {
          ok: true,
          data: {
            path: args.path,
            bytesAppended: byteLength(separator + args.content),
            before: existing,
            after: next,
          },
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
