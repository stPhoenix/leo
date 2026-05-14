import { z } from 'zod';
import type { AcceptRejectController, EditNoteProposal } from '@/agent/acceptRejectController';
import type { Logger } from '@/platform/Logger';
import type { ToolCtx, ToolSpec } from '../types';
import { isSafeVaultPath } from './readNote';
import { jsonSchemaFromZod, validateFromZod } from '../zodAdapter';
import { ensureFreshRead } from './writeGuard';
import { presentDecision } from './_toolGuards';

async function syncReadStateAfterAppend(
  ctx: ToolCtx,
  path: string,
  next: string,
  reverted: boolean,
): Promise<void> {
  if (ctx.readState === undefined) return;
  if (reverted) {
    ctx.readState.invalidate(ctx.thread, path);
    return;
  }
  const stat = await ctx.vault.stat(path);
  ctx.readState.set(ctx.thread, path, {
    content: next,
    mtimeMs: Math.floor(stat?.mtimeMs ?? Date.now()),
    offset: undefined,
    limit: undefined,
    isPartialView: false,
  });
}

export interface AppendToNoteArgs {
  readonly path: string;
  readonly content: string;
}

export interface AppendToNoteResult {
  readonly path: string;
  readonly bytesAppended: number;
  readonly decision: 'accept' | 'reject';
  readonly before: string;
  readonly after: string;
}

export interface AppendToNoteToolOptions {
  readonly acceptReject: AcceptRejectController;
  readonly logger?: Logger;
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

export function createAppendToNoteTool(
  opts: AppendToNoteToolOptions,
): ToolSpec<AppendToNoteArgs, AppendToNoteResult> {
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
        const guard = await ensureFreshRead(ctx, args.path);
        if (!guard.ok) return { ok: false, error: guard.error };
        const existing = await ctx.vault.read(args.path);
        const separator = existing.endsWith('\n') || existing.length === 0 ? '' : '\n';
        const next = existing + separator + args.content;
        // CRITICAL: do not await between the guard above and the vault.write below — see writeGuard.ts
        await ctx.vault.write(args.path, next);

        const proposal: EditNoteProposal = {
          toolId: 'append_to_note',
          intent: 'append',
          path: args.path,
          lineStart: 0,
          lineEnd: 0,
          routedVia: 'vault',
        };
        const { reverted } = await presentDecision({
          acceptReject: opts.acceptReject,
          proposal,
          logger: opts.logger,
          logKey: 'append_to_note',
          logFields: { toolId: 'append_to_note', thread: ctx.thread, path: args.path },
          revert: () => ctx.vault.write(args.path, existing),
        });

        await syncReadStateAfterAppend(ctx, args.path, next, reverted);

        return {
          ok: true,
          data: {
            path: args.path,
            bytesAppended: byteLength(separator + args.content),
            decision: reverted ? 'reject' : 'accept',
            before: existing,
            after: reverted ? existing : next,
          },
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
