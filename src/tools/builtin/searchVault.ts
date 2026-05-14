import { z } from 'zod';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import type { ToolResult, ToolSpec } from '../types';
import { jsonSchemaFromZod, validateFromZod } from '../zodAdapter';

const SearchVaultSchema: z.ZodType<SearchVaultArgs> = z
  .object({
    query: z
      .string()
      .min(1, 'query must be a non-empty string')
      .describe('Natural-language query used to rank vault chunks by semantic similarity.'),
    tags: z
      .array(z.string({ error: 'tags must be an array of strings' }))
      .optional()
      .describe('Optional list of tag names; restricts hits to chunks carrying any of them.'),
  })
  .strict() as unknown as z.ZodType<SearchVaultArgs>;

export interface SearchVaultHit {
  readonly path: string;
  readonly line_start: number;
  readonly line_end: number;
  readonly score: number;
}

export interface SearchVaultEngineResult {
  readonly hits: readonly SearchVaultHit[];
  readonly notice?: string;
}

export interface SearchVaultEngine {
  query(
    text: string,
    opts: { readonly tags?: readonly string[]; readonly signal?: AbortSignal },
  ): Promise<SearchVaultEngineResult>;
}

export interface SearchVaultArgs {
  readonly query: string;
  readonly tags?: readonly string[];
}

export interface SearchVaultResult {
  readonly hits: readonly SearchVaultHit[];
  readonly notice?: string;
}

export function createSearchVaultTool(
  engine: SearchVaultEngine,
): ToolSpec<SearchVaultArgs, SearchVaultResult> {
  return {
    id: 'search_vault',
    description: 'Semantic search over the vault; optional tag filter.',
    schema: SearchVaultSchema,
    parameters: jsonSchemaFromZod(SearchVaultSchema),
    requiresConfirmation: false,
    source: 'builtin',
    validate: validateFromZod(SearchVaultSchema),
    async invoke(args, ctx): Promise<ToolResult<SearchVaultResult>> {
      if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
      try {
        const result = await engine.query(args.query, {
          ...(args.tags !== undefined ? { tags: args.tags } : {}),
          signal: ctx.signal,
        });
        return {
          ok: true,
          data: {
            hits: result.hits,
            ...(result.notice !== undefined ? { notice: result.notice } : {}),
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
      }
    },
  };
}

const FILENAME_FALLBACK_LIMIT = 20;
const FILENAME_FALLBACK_MAX_VISIT = 5000;

function collectFilenameHits(
  listing: { files: readonly string[]; folders: readonly string[] },
  needle: string,
  hits: SearchVaultHit[],
  queue: string[],
): void {
  for (const f of listing.files) {
    if (basename(f).toLowerCase().includes(needle)) {
      hits.push({ path: f, line_start: 1, line_end: 1, score: 0 });
      if (hits.length >= FILENAME_FALLBACK_LIMIT) return;
    }
  }
  for (const d of listing.folders) queue.push(d);
}

export async function filenameMatch(
  vault: VaultAdapter,
  query: string,
  signal?: AbortSignal,
): Promise<readonly SearchVaultHit[]> {
  const needle = query.toLowerCase().trim();
  if (needle.length === 0) return [];
  const hits: SearchVaultHit[] = [];
  const queue: string[] = [''];
  let visited = 0;
  while (
    queue.length > 0 &&
    hits.length < FILENAME_FALLBACK_LIMIT &&
    !signal?.aborted &&
    visited < FILENAME_FALLBACK_MAX_VISIT
  ) {
    const cur = queue.shift() as string;
    let listing;
    try {
      listing = await vault.list(cur);
    } catch {
      continue;
    }
    visited += 1;
    collectFilenameHits(listing, needle, hits, queue);
  }
  return hits;
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}
