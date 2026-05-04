import { z } from 'zod';
import type { ToolResult, ToolSpec } from '../types';
import { jsonSchemaFromZod, validateFromZod } from '../zodAdapter';
import {
  WIKI_SEARCH_DEFAULT_N,
  buildSnippet,
  parseWikiIndex,
  summarizeFromBody,
  topNCandidates,
} from '@/agent/wiki/indexReader';
import { WIKI_DIR_PREFIX, WIKI_INDEX_PATH } from '@/agent/wiki/paths';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import type { WikiMutexState } from '@/agent/wiki/mutexTypes';
import { formatWikiBusyWarning, type WikiBusyNotifier } from '@/agent/wiki/searchWarning';

const SearchWikiSchema: z.ZodType<SearchWikiArgs> = z
  .object({
    query: z
      .string()
      .min(1, 'query must be a non-empty string')
      .describe('Knowledge query. Index-first lexical match against wiki/index.md page entries.'),
  })
  .strict() as unknown as z.ZodType<SearchWikiArgs>;

const SearchWikiResultSchema = z
  .object({
    indexConsulted: z.literal(true),
    warning: z.string().optional(),
    matches: z
      .array(
        z.object({
          path: z.string(),
          summary: z.string(),
          snippet: z.string(),
          score: z.number(),
        }),
      )
      .max(WIKI_SEARCH_DEFAULT_N),
  })
  .strict();

export interface SearchWikiArgs {
  readonly query: string;
}

export interface SearchWikiMatch {
  readonly path: string;
  readonly summary: string;
  readonly snippet: string;
  readonly score: number;
}

export interface SearchWikiResult {
  readonly indexConsulted: true;
  readonly matches: readonly SearchWikiMatch[];
  readonly warning?: string;
}

export interface SearchWikiDeps {
  readonly vault: VaultAdapter;
  readonly maxMatches?: number;
  readonly getMutexState?: () => WikiMutexState;
  readonly notifyBusy?: WikiBusyNotifier;
}

export function createSearchWikiTool(
  deps: SearchWikiDeps,
): ToolSpec<SearchWikiArgs, SearchWikiResult> {
  const maxMatches = deps.maxMatches ?? WIKI_SEARCH_DEFAULT_N;
  return {
    id: 'search_wiki',
    description:
      'Read-only search across the wiki/. Reads wiki/index.md first, returns up to N=8 matched pages with summary, snippet, and score. Never reads wiki/raw/. Prefer for knowledge / facts / concepts / entities.',
    schema: SearchWikiSchema,
    parameters: jsonSchemaFromZod(SearchWikiSchema),
    requiresConfirmation: false,
    isReadOnly: true,
    source: 'builtin',
    validate: validateFromZod(SearchWikiSchema),
    async invoke(args, ctx): Promise<ToolResult<SearchWikiResult>> {
      if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
      const mutexState = deps.getMutexState?.() ?? { kind: 'idle' as const };
      const warning = mutexState.kind === 'busy' ? formatWikiBusyWarning(mutexState) : undefined;
      if (warning !== undefined) {
        deps.notifyBusy?.(ctx.thread, warning);
      }
      try {
        const indexExists = await deps.vault.exists(WIKI_INDEX_PATH);
        if (!indexExists) {
          return {
            ok: true,
            data: SearchWikiResultSchema.parse({
              indexConsulted: true,
              matches: [],
              ...(warning !== undefined ? { warning } : {}),
            }),
          };
        }
        const indexBody = await deps.vault.read(WIKI_INDEX_PATH);
        const entries = parseWikiIndex(indexBody);
        const candidates = topNCandidates(entries, args.query, maxMatches);
        const matches: SearchWikiMatch[] = [];
        for (const c of candidates) {
          if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
          if (!c.path.startsWith(WIKI_DIR_PREFIX) || c.path.startsWith('wiki/raw/')) continue;
          let body = '';
          try {
            body = (await deps.vault.exists(c.path)) ? await deps.vault.read(c.path) : '';
          } catch {
            body = '';
          }
          matches.push({
            path: c.path,
            summary: summarizeFromBody(body, c.summary),
            snippet: buildSnippet(body, args.query),
            score: c.score,
          });
        }
        const result = SearchWikiResultSchema.parse({
          indexConsulted: true,
          matches,
          ...(warning !== undefined ? { warning } : {}),
        });
        return { ok: true, data: result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
      }
    },
  };
}
