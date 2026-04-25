import { z } from 'zod';
import type { AcceptRejectController, EditNoteProposal } from '@/agent/acceptRejectController';
import type { Logger } from '@/platform/Logger';
import type { EditNoteBridge, ToolSpec } from '../types';
import { isSafeVaultPath } from './readNote';
import { jsonSchemaFromZod, validateFromZod } from '../zodAdapter';

export type { EditNoteBridge };

export interface EditNoteArgs {
  readonly path: string;
  readonly line_start: number;
  readonly line_end: number;
  readonly new_content: string;
}

export interface EditNoteResult {
  readonly path: string;
  readonly routedVia: 'editor' | 'vault';
  readonly bytesWritten: number;
  readonly decision: 'accept' | 'reject';
}

export interface EditNoteToolOptions {
  readonly acceptReject: AcceptRejectController;
  readonly logger?: Logger;
}

const EditNoteSchema: z.ZodType<EditNoteArgs> = z
  .object({
    path: z
      .string()
      .min(1, 'path must be a non-empty string')
      .describe('Vault-relative path to the note to edit.')
      .refine(isSafeVaultPath, 'unsafe path'),
    line_start: z
      .int('line_start must be a non-negative integer')
      .nonnegative('line_start must be a non-negative integer')
      .describe('0-based inclusive start line.'),
    line_end: z
      .int('line_end must be a non-negative integer')
      .nonnegative('line_end must be a non-negative integer')
      .describe('0-based inclusive end line (>= line_start).'),
    new_content: z
      .string({ error: 'new_content must be a string' })
      .describe('Replacement content for [line_start..line_end].'),
  })
  .strict()
  .refine((v) => v.line_end >= v.line_start, 'line_end must be >= line_start');

function spliceLines(
  source: string,
  lineStart: number,
  lineEnd: number,
  replacement: string,
): { ok: true; next: string; bytesWritten: number } | { ok: false; error: string } {
  const lines = source.split('\n');
  if (lineStart > lines.length) return { ok: false, error: 'invalid range' };
  const effectiveEnd = Math.min(lineEnd, lines.length);
  const replacementLines = replacement.length === 0 ? [''] : replacement.split('\n');
  const before = lines.slice(0, lineStart);
  const after = lines.slice(effectiveEnd + 1);
  const next = [...before, ...replacementLines, ...after].join('\n');
  return { ok: true, next, bytesWritten: byteLength(replacement) };
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

export function createEditNoteTool(
  opts: EditNoteToolOptions,
): ToolSpec<EditNoteArgs, EditNoteResult> {
  return {
    id: 'edit_note',
    description:
      'Replace a line range inside a vault note with new content. Routes through the active editor (grouped undoable transaction) when the target note is currently focused; otherwise through the Vault API.',
    schema: EditNoteSchema,
    parameters: jsonSchemaFromZod(EditNoteSchema),
    requiresConfirmation: true,
    source: 'builtin',
    validate: validateFromZod(EditNoteSchema),
    async invoke(args, ctx) {
      if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
      const start = now();
      const routedVia: 'editor' | 'vault' = ctx.editor.isActiveNote(args.path) ? 'editor' : 'vault';
      opts.logger?.debug('edit_note.route', { path: args.path, routedVia });
      let commitResult:
        | { ok: true; bytesWritten: number; revert: () => void | Promise<void> }
        | { ok: false; error: string };
      if (routedVia === 'editor') {
        const applied = await ctx.editor.applyActiveEdit({
          path: args.path,
          lineStart: args.line_start,
          lineEnd: args.line_end,
          newContent: args.new_content,
          signal: ctx.signal,
        });
        if (!applied.ok) {
          return { ok: false, error: applied.error };
        }
        commitResult = {
          ok: true,
          bytesWritten: applied.bytesWritten,
          revert: () => applied.undo(),
        };
      } else {
        try {
          if (!(await ctx.vault.exists(args.path))) {
            return { ok: false, error: 'not found' };
          }
          const before = await ctx.vault.read(args.path);
          const spliced = spliceLines(before, args.line_start, args.line_end, args.new_content);
          if (!spliced.ok) return { ok: false, error: spliced.error };
          await ctx.vault.write(args.path, spliced.next);
          commitResult = {
            ok: true,
            bytesWritten: spliced.bytesWritten,
            revert: async () => {
              await ctx.vault.write(args.path, before);
            },
          };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      let reverted = false;
      const proposal: EditNoteProposal = {
        toolId: 'edit_note',
        path: args.path,
        lineStart: args.line_start,
        lineEnd: args.line_end,
        routedVia,
      };
      const decision = await opts.acceptReject.present(proposal);
      if (decision === 'reject') {
        try {
          await commitResult.revert();
          reverted = true;
          opts.logger?.info('edit_note.reject', {
            toolId: 'edit_note',
            thread: ctx.thread,
            path: args.path,
            routedVia,
            durationMs: Math.round(now() - start),
          });
        } catch (err) {
          opts.logger?.error('edit_note.reject.failed', {
            path: args.path,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        opts.logger?.info('edit_note.accept', {
          toolId: 'edit_note',
          thread: ctx.thread,
          path: args.path,
          routedVia,
          durationMs: Math.round(now() - start),
        });
      }
      return {
        ok: true,
        data: {
          path: args.path,
          routedVia,
          bytesWritten: commitResult.bytesWritten,
          decision: reverted ? 'reject' : 'accept',
        },
      };
    },
  };
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
