import type { VaultAdapter } from '@/storage/vaultAdapter';
import type { ToolSpec } from './types';
import { isSafeVaultPath } from './readNoteTool';

export interface CreateFolderArgs {
  readonly path: string;
}

export interface CreateFolderResult {
  readonly path: string;
  readonly created: boolean;
}

function validateArgs(
  raw: unknown,
): { ok: true; data: CreateFolderArgs } | { ok: false; error: string } {
  if (raw === null || typeof raw !== 'object')
    return { ok: false, error: 'args must be an object' };
  const obj = raw as Record<string, unknown>;
  if (typeof obj.path !== 'string' || obj.path.length === 0)
    return { ok: false, error: 'path must be a non-empty string' };
  if (!isSafeVaultPath(obj.path)) return { ok: false, error: 'unsafe path' };
  return { ok: true, data: { path: obj.path } };
}

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

export function createCreateFolderTool(
  vault: VaultAdapter,
): ToolSpec<CreateFolderArgs, CreateFolderResult> {
  return {
    id: 'create_folder',
    description:
      'Create a folder at a vault-relative path. Creates intermediate parent folders as needed. No-op if the folder already exists.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Vault-relative folder path, e.g. "Projects/2026/Q2". No "..", no leading "/".',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    requiresConfirmation: true,
    source: 'builtin',
    validate: validateArgs,
    async invoke(args, ctx) {
      if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
      try {
        const alreadyExists = await vault.exists(args.path);
        if (alreadyExists) {
          return { ok: true, data: { path: args.path, created: false } };
        }
        for (const prefix of cumulativePrefixes(args.path)) {
          await vault.mkdir(prefix);
        }
        return { ok: true, data: { path: args.path, created: true } };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
