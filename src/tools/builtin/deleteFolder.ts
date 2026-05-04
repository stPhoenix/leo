import { z } from 'zod';
import type { AcceptRejectController, EditNoteProposal } from '@/agent/acceptRejectController';
import type { Logger } from '@/platform/Logger';
import type { ToolSpec } from '../types';
import { isSafeVaultPath } from './readNote';
import { jsonSchemaFromZod, validateFromZod } from '../zodAdapter';

export interface DeleteFolderArgs {
  readonly path: string;
}

export interface DeleteFolderResult {
  readonly path: string;
  readonly decision: 'accept' | 'reject';
}

export interface DeleteFolderToolOptions {
  readonly acceptReject: AcceptRejectController;
  readonly logger?: Logger;
}

const DeleteFolderSchema: z.ZodType<DeleteFolderArgs> = z
  .object({
    path: z
      .string()
      .min(1, 'path must be a non-empty string')
      .describe('Vault-relative folder path to permanently delete. Folder must be empty.')
      .refine(isSafeVaultPath, 'unsafe path'),
  })
  .strict();

export function createDeleteFolderTool(
  opts: DeleteFolderToolOptions,
): ToolSpec<DeleteFolderArgs, DeleteFolderResult> {
  return {
    id: 'delete_folder',
    description:
      'Permanently delete an empty vault folder. Fails with "folder not empty" if it contains any files or subfolders — delete children first via delete_note. Pre-confirms with accept/reject before touching disk; reject is a no-op.',
    schema: DeleteFolderSchema,
    parameters: jsonSchemaFromZod(DeleteFolderSchema),
    requiresConfirmation: true,
    source: 'builtin',
    shouldDefer: true,
    validate: validateFromZod(DeleteFolderSchema),
    async invoke(args, ctx) {
      if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
      try {
        if (!(await ctx.vault.exists(args.path))) {
          return { ok: false, error: 'folder not found' };
        }
        let listing;
        try {
          listing = await ctx.vault.list(args.path);
        } catch {
          return { ok: false, error: 'not a folder' };
        }
        if (listing.files.length > 0 || listing.folders.length > 0) {
          return { ok: false, error: 'folder not empty' };
        }
        const proposal: EditNoteProposal = {
          toolId: 'delete_folder',
          intent: 'delete',
          path: args.path,
          lineStart: 0,
          lineEnd: 0,
          routedVia: 'vault',
        };
        const decision = await opts.acceptReject.present(proposal);
        if (decision === 'reject') {
          opts.logger?.info('delete_folder.reject', {
            toolId: 'delete_folder',
            thread: ctx.thread,
            path: args.path,
          });
          return { ok: true, data: { path: args.path, decision: 'reject' } };
        }
        if (ctx.vault.rmdir === undefined) {
          return { ok: false, error: 'rmdir unsupported' };
        }
        await ctx.vault.rmdir(args.path);
        opts.logger?.info('delete_folder.accept', {
          toolId: 'delete_folder',
          thread: ctx.thread,
          path: args.path,
        });
        return { ok: true, data: { path: args.path, decision: 'accept' } };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
