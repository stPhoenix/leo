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

interface WikiCandidate {
  readonly path: string;
  readonly summary: string;
  readonly score: number;
}

async function readWikiBody(vault: VaultAdapter, path: string): Promise<string> {
  try {
    return (await vault.exists(path)) ? await vault.read(path) : '';
  } catch {
    return '';
  }
}

async function collectWikiMatches(
  candidates: readonly WikiCandidate[],
  query: string,
  deps: SearchWikiDeps,
  signal: AbortSignal,
): Promise<readonly SearchWikiMatch[] | 'aborted'> {
  const matches: SearchWikiMatch[] = [];
  for (const c of candidates) {
    if (signal.aborted) return 'aborted';
    if (!c.path.startsWith(WIKI_DIR_PREFIX) || c.path.startsWith('wiki/raw/')) continue;
    const body = await readWikiBody(deps.vault, c.path);
    matches.push({
      path: c.path,
      summary: summarizeFromBody(body, c.summary),
      snippet: buildSnippet(body, query),
      score: c.score,
    });
  }
  return matches;
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
      if (warning !== undefined) deps.notifyBusy?.(ctx.thread, warning);
      try {
        if (!(await deps.vault.exists(WIKI_INDEX_PATH))) {
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
        const matches = await collectWikiMatches(candidates, args.query, deps, ctx.signal);
        if (matches === 'aborted') return { ok: false, error: 'aborted' };
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
