import { z } from 'zod';
import type { AcceptRejectController, EditNoteProposal } from '@/agent/acceptRejectController';
import type { Logger } from '@/platform/Logger';
import type { ToolCtx, ToolSpec } from '../types';
import { isSafeVaultPath } from './readNote';
import { jsonSchemaFromZod, validateFromZod } from '../zodAdapter';
import { ensureFreshRead } from './writeGuard';
import { presentDecision } from './_toolGuards';

async function syncReadStateAfterDelete(
  ctx: ToolCtx,
  path: string,
  before: string,
  reverted: boolean,
): Promise<void> {
  if (ctx.readState === undefined) return;
  if (!reverted) {
    ctx.readState.invalidate(ctx.thread, path);
    return;
  }
  const stat = await ctx.vault.stat(path);
  ctx.readState.set(ctx.thread, path, {
    content: before,
    mtimeMs: Math.floor(stat?.mtimeMs ?? Date.now()),
    offset: undefined,
    limit: undefined,
    isPartialView: false,
  });
}

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
        const { reverted } = await presentDecision({
          acceptReject: opts.acceptReject,
          proposal,
          logger: opts.logger,
          logKey: 'delete_note',
          logFields: { toolId: 'delete_note', thread: ctx.thread, path: args.path },
          revert: () => ctx.vault.write(args.path, before),
        });

        await syncReadStateAfterDelete(ctx, args.path, before, reverted);

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
