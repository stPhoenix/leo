import { z } from 'zod';
import type { AcceptRejectController, EditNoteProposal } from '@/agent/acceptRejectController';
import type { Logger } from '@/platform/Logger';
import type { ToolSpec } from '../types';
import { isSafeVaultPath } from './readNote';
import { jsonSchemaFromZod, validateFromZod } from '../zodAdapter';
import { ensureFreshRead } from './writeGuard';

export interface DeleteNoteArgs {
  readonly path: string;
}

export interface DeleteNoteResult {
  readonly path: string;
  readonly bytesDeleted: number;
  readonly decision: 'accept' | 'reject';
  readonly before: string;
}

export interface DeleteNoteToolOptions {
  readonly acceptReject: AcceptRejectController;
  readonly logger?: Logger;
}

const DeleteNoteSchema: z.ZodType<DeleteNoteArgs> = z
  .object({
    path: z
      .string()
      .min(1, 'path must be a non-empty string')
      .describe('Vault-relative path to the note to permanently delete.')
      .refine(isSafeVaultPath, 'unsafe path'),
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

export function createDeleteNoteTool(
  opts: DeleteNoteToolOptions,
): ToolSpec<DeleteNoteArgs, DeleteNoteResult> {
  return {
    id: 'delete_note',
    description:
      'Permanently delete a vault note. Requires the note to have been read first (freshness check) so the agent has seen current content. On reject the captured content is re-written as a recovery; on accept the deletion is final.',
    schema: DeleteNoteSchema,
    parameters: jsonSchemaFromZod(DeleteNoteSchema),
    requiresConfirmation: true,
    source: 'builtin',
    shouldDefer: true,
    validate: validateFromZod(DeleteNoteSchema),
    async invoke(args, ctx) {
      if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
      try {
        const guard = await ensureFreshRead(ctx, args.path);
        if (!guard.ok) return { ok: false, error: guard.error };
        const before = await ctx.vault.read(args.path);
        await ctx.vault.remove(args.path);

        const proposal: EditNoteProposal = {
          toolId: 'delete_note',
          intent: 'delete',
          path: args.path,
          lineStart: 0,
          lineEnd: 0,
          routedVia: 'vault',
        };
        const decision = await opts.acceptReject.present(proposal);
        let reverted = false;
        if (decision === 'reject') {
          try {
            await ctx.vault.write(args.path, before);
            reverted = true;
            opts.logger?.info('delete_note.reject', {
              toolId: 'delete_note',
              thread: ctx.thread,
              path: args.path,
            });
          } catch (err) {
            opts.logger?.error('delete_note.reject.failed', {
              path: args.path,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        } else {
          opts.logger?.info('delete_note.accept', {
            toolId: 'delete_note',
            thread: ctx.thread,
            path: args.path,
          });
        }

        if (ctx.readState !== undefined) {
          if (reverted) {
            const stat = await ctx.vault.stat(args.path);
            ctx.readState.set(ctx.thread, args.path, {
              content: before,
              mtimeMs: Math.floor(stat?.mtimeMs ?? Date.now()),
              offset: undefined,
              limit: undefined,
              isPartialView: false,
            });
          } else {
            ctx.readState.invalidate(ctx.thread, args.path);
          }
        }

        return {
          ok: true,
          data: {
            path: args.path,
            bytesDeleted: byteLength(before),
            decision: reverted ? 'reject' : 'accept',
            before,
          },
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
