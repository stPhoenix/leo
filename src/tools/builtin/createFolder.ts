import { z } from 'zod';
import type { ToolSpec } from '../types';
import { isSafeVaultPath } from './readNote';
import { jsonSchemaFromZod, validateFromZod } from '../zodAdapter';

export interface CreateFolderArgs {
  readonly path: string;
}

export interface CreateFolderResult {
  readonly path: string;
  readonly created: boolean;
}

const CreateFolderSchema: z.ZodType<CreateFolderArgs> = z
  .object({
    path: z
      .string()
      .min(1, 'path must be a non-empty string')
      .describe('Vault-relative folder path, e.g. "Projects/2026/Q2". No "..", no leading "/".')
      .refine(isSafeVaultPath, 'unsafe path'),
  })
  .strict();

function cumulativePrefixes(path: string): string[] {
  const parts = path.split('/').filter((s) => s.length > 0);
  const prefixes: string[] = [];
  let acc = '';
  for (const part of parts) {
    acc = acc.length === 0 ? part : `${acc}/${part}`;
    prefixes.push(acc);
  }
  return prefixes;
}

export function createCreateFolderTool(): ToolSpec<CreateFolderArgs, CreateFolderResult> {
  return {
    id: 'create_folder',
    description:
      'Create a folder at a vault-relative path. Creates intermediate parent folders as needed. No-op if the folder already exists.',
    schema: CreateFolderSchema,
    parameters: jsonSchemaFromZod(CreateFolderSchema),
    requiresConfirmation: true,
    source: 'builtin',
    validate: validateFromZod(CreateFolderSchema),
    async invoke(args, ctx) {
      if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
      try {
        const alreadyExists = await ctx.vault.exists(args.path);
        if (alreadyExists) {
          return { ok: true, data: { path: args.path, created: false } };
        }
        for (const prefix of cumulativePrefixes(args.path)) {
          await ctx.vault.mkdir(prefix);
        }
        return { ok: true, data: { path: args.path, created: true } };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
