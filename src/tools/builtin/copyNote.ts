import { z } from 'zod';
import type { AcceptRejectController, EditNoteProposal } from '@/agent/acceptRejectController';
import type { Logger } from '@/platform/Logger';
import type { ToolCtx, ToolSpec } from '../types';
import { isSafeVaultPath } from './readNote';
import { jsonSchemaFromZod, validateFromZod } from '../zodAdapter';
import { presentDecision } from './_toolGuards';

async function performCopy(ctx: ToolCtx, src: string, dst: string): Promise<void> {
  if (ctx.vault.copy !== undefined) {
    await ctx.vault.copy(src, dst);
    return;
  }
  const data = await ctx.vault.read(src);
  await ctx.vault.write(dst, data);
}

export interface CopyNoteArgs {
  readonly path: string;
  readonly new_path: string;
}

export interface CopyNoteResult {
  readonly path: string;
  readonly newPath: string;
  readonly decision: 'accept' | 'reject';
}

export interface CopyNoteToolOptions {
  readonly acceptReject: AcceptRejectController;
  readonly logger?: Logger;
}

const CopyNoteSchema: z.ZodType<CopyNoteArgs> = z
  .object({
    path: z
      .string()
      .min(1, 'path must be a non-empty string')
      .describe('Vault-relative path to the source note.')
      .refine(isSafeVaultPath, 'unsafe path'),
    new_path: z
      .string()
      .min(1, 'new_path must be a non-empty string')
      .describe('Vault-relative destination path for the copy. Must not already exist.')
      .refine(isSafeVaultPath, 'unsafe path'),
  })
  .strict()
  .refine((v) => v.path !== v.new_path, 'new_path must differ from path');

export function createCopyNoteTool(
  opts: CopyNoteToolOptions,
): ToolSpec<CopyNoteArgs, CopyNoteResult> {
  return {
    id: 'copy_note',
    description:
      'Duplicate a vault note from `path` to `new_path`. The original is left untouched. Fails if the destination already exists.',
    schema: CopyNoteSchema,
    parameters: jsonSchemaFromZod(CopyNoteSchema),
    requiresConfirmation: true,
    source: 'builtin',
    shouldDefer: true,
    validate: validateFromZod(CopyNoteSchema),
    async invoke(args, ctx) {
      if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
      try {
        if (!(await ctx.vault.exists(args.path))) {
          return { ok: false, error: `note not found: ${args.path}` };
        }
        if (await ctx.vault.exists(args.new_path)) {
          return { ok: false, error: `destination exists: ${args.new_path}` };
        }
        await performCopy(ctx, args.path, args.new_path);

        const proposal: EditNoteProposal = {
          toolId: 'copy_note',
          intent: 'copy',
          path: args.path,
          newPath: args.new_path,
          lineStart: 0,
          lineEnd: 0,
          routedVia: 'vault',
        };
        const { reverted } = await presentDecision({
          acceptReject: opts.acceptReject,
          proposal,
          logger: opts.logger,
          logKey: 'copy_note',
          logFields: {
            toolId: 'copy_note',
            thread: ctx.thread,
            from: args.path,
            to: args.new_path,
          },
          revert: () => ctx.vault.remove(args.new_path),
        });

        return {
          ok: true,
          data: {
            path: args.path,
            newPath: args.new_path,
            decision: reverted ? 'reject' : 'accept',
          },
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
