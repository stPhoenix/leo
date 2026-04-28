import { z } from 'zod';
import type { ToolSpec } from '../types';
import { jsonSchemaFromZod, validateFromZod } from '../zodAdapter';
import { isSafeVaultPath } from './readNote';

export interface OpenNoteArgs {
  readonly path: string;
}

export interface OpenNoteResult {
  readonly path: string;
  readonly status: 'opened' | 'revealed';
}

const OpenNoteSchema: z.ZodType<OpenNoteArgs> = z
  .object({
    path: z
      .string()
      .min(1, 'path must be a non-empty string')
      .describe('Vault-relative path to the note, e.g. "Notes/Daily.md".')
      .refine(isSafeVaultPath, 'path must be vault-relative and must not traverse parents'),
  })
  .strict();

export function createOpenNoteTool(): ToolSpec<OpenNoteArgs, OpenNoteResult> {
  return {
    id: 'open_note',
    description:
      'Open a note in Obsidian. If the note is already open in a leaf, focus that leaf; otherwise open it in a new leaf. Use when the user asks to open, show, or jump to a note.',
    schema: OpenNoteSchema,
    parameters: jsonSchemaFromZod(OpenNoteSchema),
    requiresConfirmation: false,
    isReadOnly: true,
    source: 'builtin',
    validate: validateFromZod(OpenNoteSchema),
    async invoke(args, ctx) {
      if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
      if (ctx.navigator === undefined) {
        return { ok: false, error: 'navigator unavailable' };
      }
      const result = await ctx.navigator.openNote(args.path);
      if (!result.ok) return result;
      return { ok: true, data: { path: args.path, status: result.status } };
    },
  };
}
