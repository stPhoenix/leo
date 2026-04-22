import type { ToolResult, ToolSpec } from '../types';

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
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural-language query used to rank vault chunks by semantic similarity.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of tag names; restricts hits to chunks carrying any of them.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    requiresConfirmation: false,
    source: 'builtin',
    validate(raw): ToolResult<SearchVaultArgs> {
      if (raw === null || typeof raw !== 'object') {
        return { ok: false, error: 'args must be an object' };
      }
      const obj = raw as Record<string, unknown>;
      if (typeof obj.query !== 'string' || obj.query.length === 0) {
        return { ok: false, error: 'query must be a non-empty string' };
      }
      if (obj.tags !== undefined) {
        if (!Array.isArray(obj.tags)) {
          return { ok: false, error: 'tags must be an array of strings' };
        }
        for (const t of obj.tags) {
          if (typeof t !== 'string') {
            return { ok: false, error: 'tags must be an array of strings' };
          }
        }
        return { ok: true, data: { query: obj.query, tags: obj.tags as string[] } };
      }
      return { ok: true, data: { query: obj.query } };
    },
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
