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

function hasHiddenSegment(p: string): boolean {
  if (p.length === 0) return false;
  for (const seg of p.split('/')) {
    if (seg.startsWith('.')) return true;
  }
  return false;
}

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
      'List files and folders at a vault-relative path. Use to discover what exists when structure is unknown. `recursive: true` walks subtree. Empty/omitted path = vault root. Hidden entries (any path segment starting with ".", e.g. .obsidian, .leo, .git) are excluded.',
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
        if (args.recursive !== true) return await listShallow(root, ctx);
        return await listRecursive(root, ctx);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

interface ListVaultCtx {
  readonly vault: {
    list(p: string): Promise<{ files: readonly string[]; folders: readonly string[] }>;
  };
  readonly signal: AbortSignal;
}

async function listShallow(
  root: string,
  ctx: ListVaultCtx,
): Promise<{ ok: true; data: { path: string; files: string[]; folders: string[] } }> {
  const listing = await ctx.vault.list(root);
  return {
    ok: true,
    data: {
      path: root,
      files: listing.files.filter((f) => !hasHiddenSegment(f)),
      folders: listing.folders.filter((d) => !hasHiddenSegment(d)),
    },
  };
}

async function listRecursive(
  root: string,
  ctx: ListVaultCtx,
): Promise<
  | { ok: true; data: { path: string; files: string[]; folders: string[]; truncated?: true } }
  | { ok: false; error: string }
> {
  const files: string[] = [];
  const folders: string[] = [];
  const queue: string[] = [root];
  let truncated = false;
  while (queue.length > 0 && !truncated) {
    if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
    const cur = queue.shift() as string;
    const listing = await ctx.vault.list(cur);
    truncated = collectListingEntries(listing, files, folders, queue);
  }
  return {
    ok: true,
    data: { path: root, files, folders, ...(truncated ? { truncated: true } : {}) },
  };
}

// Returns true when MAX_ENTRIES is hit and the caller should stop.
function collectListingEntries(
  listing: { files: readonly string[]; folders: readonly string[] },
  files: string[],
  folders: string[],
  queue: string[],
): boolean {
  for (const f of listing.files) {
    if (hasHiddenSegment(f)) continue;
    if (files.length + folders.length >= MAX_ENTRIES) return true;
    files.push(f);
  }
  for (const d of listing.folders) {
    if (hasHiddenSegment(d)) continue;
    if (files.length + folders.length >= MAX_ENTRIES) return true;
    folders.push(d);
    queue.push(d);
  }
  return false;
}
