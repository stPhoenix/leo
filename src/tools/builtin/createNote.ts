import { z } from 'zod';
import type { AcceptRejectController, EditNoteProposal } from '@/agent/acceptRejectController';
import type { Logger } from '@/platform/Logger';
import type { ToolSpec } from '../types';
import { isSafeVaultPath } from './readNote';
import { jsonSchemaFromZod, validateFromZod } from '../zodAdapter';

export interface CreateNoteArgs {
  readonly path: string;
  readonly content: string;
}

export interface CreateNoteResult {
  readonly path: string;
  readonly bytesWritten: number;
  readonly decision: 'accept' | 'reject';
  readonly before: string;
  readonly after: string;
}

export interface CreateNoteToolOptions {
  readonly acceptReject: AcceptRejectController;
  readonly logger?: Logger;
}

const CreateNoteSchema: z.ZodType<CreateNoteArgs> = z
  .object({
    path: z
      .string()
      .min(1, 'path must be a non-empty string')
      .describe('Vault-relative path to the new note.')
      .refine(isSafeVaultPath, 'unsafe path'),
    content: z
      .string({ error: 'content must be a string' })
      .describe('Markdown content to write to the new note.'),
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

export function createCreateNoteTool(
  opts: CreateNoteToolOptions,
): ToolSpec<CreateNoteArgs, CreateNoteResult> {
  return {
    id: 'create_note',
    description:
      'Create a new markdown note at a vault-relative path with the given content. Fails if the file already exists.',
    schema: CreateNoteSchema,
    parameters: jsonSchemaFromZod(CreateNoteSchema),
    requiresConfirmation: true,
    source: 'builtin',
    validate: validateFromZod(CreateNoteSchema),
    async invoke(args, ctx) {
      if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
      try {
        if (await ctx.vault.exists(args.path)) {
          return { ok: false, error: 'file exists' };
        }
        await ctx.vault.write(args.path, args.content);

        const proposal: EditNoteProposal = {
          toolId: 'create_note',
          intent: 'create',
          path: args.path,
          lineStart: 0,
          lineEnd: 0,
          routedVia: 'vault',
        };
        const decision = await opts.acceptReject.present(proposal);
        let reverted = false;
        if (decision === 'reject') {
          try {
            await ctx.vault.remove(args.path);
            reverted = true;
            opts.logger?.info('create_note.reject', {
              toolId: 'create_note',
              thread: ctx.thread,
              path: args.path,
            });
          } catch (err) {
            opts.logger?.error('create_note.reject.failed', {
              path: args.path,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        } else {
          opts.logger?.info('create_note.accept', {
            toolId: 'create_note',
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
              content: args.content,
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
            bytesWritten: byteLength(args.content),
            decision: reverted ? 'reject' : 'accept',
            before: '',
            after: reverted ? '' : args.content,
          },
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
