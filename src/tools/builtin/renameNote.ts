import { z } from 'zod';
import type { AcceptRejectController, EditNoteProposal } from '@/agent/acceptRejectController';
import type { Logger } from '@/platform/Logger';
import type { ToolCtx, ToolResult, ToolSpec } from '../types';
import { isSafeVaultPath } from './readNote';
import { jsonSchemaFromZod, validateFromZod } from '../zodAdapter';

export interface RenameNoteArgs {
  readonly path: string;
  readonly new_path: string;
}

export interface RenameNoteResult {
  readonly path: string;
  readonly newPath: string;
  readonly decision: 'accept' | 'reject';
}

export interface RenameNoteToolOptions {
  readonly acceptReject: AcceptRejectController;
  readonly logger?: Logger;
}

const RenameNoteSchema: z.ZodType<RenameNoteArgs> = z
  .object({
    path: z
      .string()
      .min(1, 'path must be a non-empty string')
      .describe('Vault-relative path to the note to rename.')
      .refine(isSafeVaultPath, 'unsafe path'),
    new_path: z
      .string()
      .min(1, 'new_path must be a non-empty string')
      .describe('Vault-relative destination path. Must not already exist.')
      .refine(isSafeVaultPath, 'unsafe path'),
  })
  .strict()
  .refine((v) => v.path !== v.new_path, 'new_path must differ from path');

export async function runRename(
  ctx: ToolCtx,
  args: RenameNoteArgs,
  opts: RenameNoteToolOptions,
  intent: 'rename' | 'move',
): Promise<ToolResult<RenameNoteResult>> {
  if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
  try {
    if (!(await ctx.vault.exists(args.path))) {
      return { ok: false, error: `note not found: ${args.path}` };
    }
    if (await ctx.vault.exists(args.new_path)) {
      return { ok: false, error: `destination exists: ${args.new_path}` };
    }
    const renamer = ctx.vault.renameWithLinks?.bind(ctx.vault) ?? ctx.vault.rename.bind(ctx.vault);
    await renamer(args.path, args.new_path);

    const proposal: EditNoteProposal = {
      toolId: intent === 'rename' ? 'rename_note' : 'move_note',
      intent,
      path: args.path,
      newPath: args.new_path,
      lineStart: 0,
      lineEnd: 0,
      routedVia: 'vault',
    };
    const decision = await opts.acceptReject.present(proposal);
    let reverted = false;
    if (decision === 'reject') {
      try {
        await renamer(args.new_path, args.path);
        reverted = true;
        opts.logger?.info(`${intent}_note.reject`, {
          toolId: proposal.toolId,
          thread: ctx.thread,
          from: args.path,
          to: args.new_path,
        });
      } catch (err) {
        opts.logger?.warn(`${intent}_note.reject.partial`, {
          toolId: proposal.toolId,
          from: args.path,
          to: args.new_path,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      opts.logger?.info(`${intent}_note.accept`, {
        toolId: proposal.toolId,
        thread: ctx.thread,
        from: args.path,
        to: args.new_path,
      });
    }

    if (ctx.readState !== undefined) {
      ctx.readState.invalidate(ctx.thread, args.path);
      ctx.readState.invalidate(ctx.thread, args.new_path);
    }

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
}

export function createRenameNoteTool(
  opts: RenameNoteToolOptions,
): ToolSpec<RenameNoteArgs, RenameNoteResult> {
  return {
    id: 'rename_note',
    description:
      'Rename or relocate a vault note from `path` to `new_path`. Updates wiki-links across the vault via Obsidian fileManager. Fails if the destination already exists. Prefer this over edit_note for path changes.',
    schema: RenameNoteSchema,
    parameters: jsonSchemaFromZod(RenameNoteSchema),
    requiresConfirmation: true,
    source: 'builtin',
    shouldDefer: true,
    validate: validateFromZod(RenameNoteSchema),
    invoke(args, ctx) {
      return runRename(ctx, args, opts, 'rename');
    },
  };
}
