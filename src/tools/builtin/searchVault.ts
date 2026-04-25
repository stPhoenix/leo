import { z } from 'zod';
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

export interface SearchVaultEngine {
  query(
    text: string,
    opts: { readonly tags?: readonly string[]; readonly signal?: AbortSignal },
  ): Promise<readonly SearchVaultHit[]>;
}

export interface SearchVaultArgs {
  readonly query: string;
  readonly tags?: readonly string[];
}

export interface SearchVaultResult {
  readonly hits: readonly SearchVaultHit[];
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
        const hits = await engine.query(args.query, {
          ...(args.tags !== undefined ? { tags: args.tags } : {}),
          signal: ctx.signal,
        });
        return { ok: true, data: { hits } };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
      }
    },
  };
}
