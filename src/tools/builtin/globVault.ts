import { z } from 'zod';
import { minimatch } from 'minimatch';
import type { ToolSpec } from '../types';
import { jsonSchemaFromZod, validateFromZod } from '../zodAdapter';
import { isSafeVaultPath } from './readNote';

export interface GlobVaultArgs {
  readonly pattern: string;
  readonly path?: string;
}

export interface GlobVaultResult {
  readonly pattern: string;
  readonly path: string;
  readonly filenames: readonly string[];
  readonly numFiles: number;
  readonly truncated: boolean;
  readonly durationMs: number;
}

const MAX_ENTRIES = 5000;
const MAX_RESULTS = 1000;

const GlobVaultSchema: z.ZodType<GlobVaultArgs> = z
  .object({
    pattern: z
      .string()
      .min(1, 'pattern must be a non-empty string')
      .describe(
        'Minimatch glob pattern, e.g. "**/*.ts", "Notes/**/*.md". Pattern is interpreted relative to `path`.',
      ),
    path: z
      .string()
      .optional()
      .describe(
        'Vault-relative folder to search under. Empty or omitted = vault root. No "..", no leading "/".',
      )
      .refine(
        (p) => p === undefined || p === '' || isSafeVaultPath(p),
        'path must be vault-relative and must not traverse parents',
      ),
  })
  .strict();

function hasHiddenSegment(p: string): boolean {
  if (p.length === 0) return false;
  for (const seg of p.split('/')) {
    if (seg.startsWith('.')) return true;
  }
  return false;
}

function relativize(root: string, full: string): string {
  if (root.length === 0) return full;
  const prefix = root.endsWith('/') ? root : `${root}/`;
  return full.startsWith(prefix) ? full.slice(prefix.length) : full;
}

export function createGlobVaultTool(): ToolSpec<GlobVaultArgs, GlobVaultResult> {
  return {
    id: 'glob_vault',
    description:
      'Find vault files matching a glob pattern. Returns paths sorted by mtime descending. Use for structural discovery (e.g. "**/*.ts", "Notes/2026-*.md"). Honors the user exclude-list.',
    schema: GlobVaultSchema,
    parameters: jsonSchemaFromZod(GlobVaultSchema),
    requiresConfirmation: false,
    isReadOnly: true,
    source: 'builtin',
    validate: validateFromZod(GlobVaultSchema),
    async invoke(args, ctx) {
      if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
      const start = now();
      const root = args.path ?? '';
      try {
        if (root.length > 0 && !(await ctx.vault.exists(root))) {
          return { ok: false, error: `folder not found: ${root}` };
        }
        const collected = await collectGlobMatches(args.pattern, root, ctx);
        if (collected === 'aborted') return { ok: false, error: 'aborted' };
        const filenames = await sortByMtimeDesc(collected.matches, ctx);
        return {
          ok: true,
          data: {
            pattern: args.pattern,
            path: root,
            filenames,
            numFiles: filenames.length,
            truncated: collected.truncated,
            durationMs: Math.round(now() - start),
          },
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

interface CollectedMatches {
  readonly matches: readonly string[];
  readonly truncated: boolean;
}

async function collectGlobMatches(
  pattern: string,
  root: string,
  ctx: {
    vault: { list(p: string): Promise<{ files: readonly string[]; folders: readonly string[] }> };
    signal: AbortSignal;
    excludeMatcher?: (p: string) => boolean;
  },
): Promise<CollectedMatches | 'aborted'> {
  const matches: string[] = [];
  const queue: string[] = [root];
  let visited = 0;
  let truncated = false;
  while (queue.length > 0) {
    if (ctx.signal.aborted) return 'aborted';
    if (visited >= MAX_ENTRIES) {
      truncated = true;
      break;
    }
    const cur = queue.shift() as string;
    let listing;
    try {
      listing = await ctx.vault.list(cur);
    } catch {
      continue;
    }
    visited += 1;
    if (matchListingFiles(listing.files, pattern, root, ctx, matches)) {
      truncated = true;
      break;
    }
    for (const d of listing.folders) {
      if (hasHiddenSegment(d)) continue;
      queue.push(d);
    }
  }
  return { matches, truncated };
}

function matchListingFiles(
  files: readonly string[],
  pattern: string,
  root: string,
  ctx: { excludeMatcher?: (p: string) => boolean },
  matches: string[],
): boolean {
  for (const f of files) {
    if (hasHiddenSegment(f)) continue;
    if (ctx.excludeMatcher?.(f) === true) continue;
    const rel = relativize(root, f);
    if (!minimatch(rel, pattern, { dot: true, matchBase: false })) continue;
    matches.push(f);
    if (matches.length >= MAX_RESULTS) return true;
  }
  return false;
}

async function sortByMtimeDesc(
  matches: readonly string[],
  ctx: { vault: { stat(p: string): Promise<{ mtimeMs: number } | null> } },
): Promise<string[]> {
  const stats = await Promise.allSettled(matches.map((p) => ctx.vault.stat(p)));
  const decorated: { path: string; mtime: number }[] = matches.map((p, i) => {
    const result = stats[i];
    const mtime =
      result?.status === 'fulfilled' && result.value !== null ? result.value.mtimeMs : 0;
    return { path: p, mtime };
  });
  decorated.sort((a, b) => {
    if (b.mtime !== a.mtime) return b.mtime - a.mtime;
    return a.path.localeCompare(b.path);
  });
  return decorated.map((d) => d.path);
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
