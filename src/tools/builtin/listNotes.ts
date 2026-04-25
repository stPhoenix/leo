import { z } from 'zod';
import type { ToolSpec } from '../types';
import { isSafeVaultPath } from './readNote';
import { jsonSchemaFromZod, validateFromZod } from '../zodAdapter';

export interface ListNotesArgs {
  readonly path?: string;
  readonly recursive?: boolean;
}

export interface ListNotesResult {
  readonly path: string;
  readonly files: readonly string[];
  readonly folders: readonly string[];
  readonly truncated?: boolean;
}

const MAX_ENTRIES = 5000;

const ListNotesSchema: z.ZodType<ListNotesArgs> = z
  .object({
    path: z
      .string()
      .optional()
      .describe(
        'Vault-relative folder path. Empty or omitted = vault root. No "..", no leading "/".',
      )
      .refine(
        (p) => p === undefined || p === '' || isSafeVaultPath(p),
        'path must be vault-relative and must not traverse parents',
      ),
    recursive: z
      .boolean()
      .optional()
      .describe('When true, walks the entire subtree under `path`. Default false.'),
  })
  .strict();

export function createListNotesTool(): ToolSpec<ListNotesArgs, ListNotesResult> {
  return {
    id: 'list_notes',
    description:
      'List files and folders at a vault-relative path. Use to discover what exists when structure is unknown. `recursive: true` walks subtree. Empty/omitted path = vault root.',
    schema: ListNotesSchema,
    parameters: jsonSchemaFromZod(ListNotesSchema),
    requiresConfirmation: false,
    source: 'builtin',
    validate: validateFromZod(ListNotesSchema),
    async invoke(args, ctx) {
      if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
      const root = args.path ?? '';
      try {
        if (root.length > 0 && !(await ctx.vault.exists(root))) {
          return { ok: false, error: `folder not found: ${root}` };
        }
        if (args.recursive !== true) {
          const listing = await ctx.vault.list(root);
          return {
            ok: true,
            data: { path: root, files: [...listing.files], folders: [...listing.folders] },
          };
        }
        const files: string[] = [];
        const folders: string[] = [];
        const queue: string[] = [root];
        let truncated = false;
        while (queue.length > 0) {
          if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
          const cur = queue.shift() as string;
          const listing = await ctx.vault.list(cur);
          for (const f of listing.files) {
            if (files.length + folders.length >= MAX_ENTRIES) {
              truncated = true;
              break;
            }
            files.push(f);
          }
          if (truncated) break;
          for (const d of listing.folders) {
            if (files.length + folders.length >= MAX_ENTRIES) {
              truncated = true;
              break;
            }
            folders.push(d);
            queue.push(d);
          }
          if (truncated) break;
        }
        return {
          ok: true,
          data: { path: root, files, folders, ...(truncated ? { truncated: true } : {}) },
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
