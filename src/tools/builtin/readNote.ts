import { z } from 'zod';
import type { ToolSpec } from '../types';
import { jsonSchemaFromZod, validateFromZod } from '../zodAdapter';
import { byteLength, findSimilarPaths } from './readFileShared';

export interface ReadNoteArgs {
  readonly path: string;
}

export interface ReadNoteResult {
  readonly path: string;
  readonly content: string;
  readonly bytes: number;
  readonly unchanged?: boolean;
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
    isReadOnly: true,
    source: 'builtin',
    validate: validateFromZod(ReadNoteSchema),
    async invoke(args, ctx) {
      if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
      try {
        if (!(await ctx.vault.exists(args.path))) {
          const suggestions = await findSimilarPaths(ctx.vault, args.path, 3, ctx.signal);
          const suffix = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(', ')}?` : '';
          return { ok: false, error: `note not found: ${args.path}.${suffix}` };
        }
        const stat = await ctx.vault.stat(args.path);
        const mtimeMs = Math.floor(stat?.mtimeMs ?? 0);
        if (ctx.readState !== undefined && stat !== null) {
          const cached = ctx.readState.matches(
            ctx.thread,
            args.path,
            mtimeMs,
            undefined,
            undefined,
          );
          if (cached !== undefined) {
            return {
              ok: true,
              data: {
                path: args.path,
                content:
                  '<system-reminder>Note unchanged since last read. The content from the earlier read_note tool result in this conversation is still current — refer to that instead of re-reading.</system-reminder>',
                bytes: 0,
                unchanged: true,
              },
            };
          }
        }
        const content = await ctx.vault.read(args.path);
        const bytes = byteLength(content);
        if (bytes > MAX_BYTES) {
          return { ok: false, error: `note too large (${bytes} bytes; limit ${MAX_BYTES})` };
        }
        if (ctx.readState !== undefined) {
          ctx.readState.set(ctx.thread, args.path, {
            content,
            mtimeMs,
            offset: undefined,
            limit: undefined,
            isPartialView: false,
          });
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
