import { z } from 'zod';
import type { AcceptRejectController, EditNoteProposal } from '@/agent/acceptRejectController';
import type { Logger } from '@/platform/Logger';
import type { ToolSpec } from '../types';
import { isSafeVaultPath } from './readNote';
import { jsonSchemaFromZod, validateFromZod } from '../zodAdapter';
import { ensureFreshRead } from './writeGuard';

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
        const decision = await opts.acceptReject.present(proposal);
        let reverted = false;
        if (decision === 'reject') {
          try {
            await ctx.vault.write(args.path, existing);
            reverted = true;
            opts.logger?.info('append_to_note.reject', {
              toolId: 'append_to_note',
              thread: ctx.thread,
              path: args.path,
            });
          } catch (err) {
            opts.logger?.error('append_to_note.reject.failed', {
              path: args.path,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        } else {
          opts.logger?.info('append_to_note.accept', {
            toolId: 'append_to_note',
            thread: ctx.thread,
            path: args.path,
          });
        }

        if (ctx.readState !== undefined) {
          if (reverted) {
            ctx.readState.invalidate(ctx.thread, args.path);
          } else {
            const stat = await ctx.vault.stat(args.path);
            ctx.readState.set(ctx.thread, args.path, {
              content: next,
              mtimeMs: Math.floor(stat?.mtimeMs ?? Date.now()),
              offset: undefined,
              limit: undefined,
              isPartialView: false,
            });
          }
        }

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
