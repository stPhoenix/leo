import { z } from 'zod';
import type { ToolSpec } from '@/tools/types';
import { jsonSchemaFromZod, validateFromZod } from '@/tools/zodAdapter';
import { search } from './searchAlgorithm';
import { renderTextSchemas } from './renderTextSchemas';
import type { SearchSnapshot, ToolSearchInvocationResult } from './types';
import { TOOL_SEARCH_DESCRIPTION } from '@/prompts/tools/toolSearch/toolSearchDescription';

export const TOOL_SEARCH_TOOL_ID = 'ToolSearch';

export interface ToolSearchArgs {
  readonly query: string;
  readonly max_results?: number;
}

const ToolSearchSchema: z.ZodType<ToolSearchArgs> = z
  .object({
    query: z
      .string()
      .min(1, 'query is required')
      .describe(
        'Query to find deferred tools. Use "select:<tool_name>" for direct selection, or keywords to search.',
      ),
    max_results: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Maximum number of results to return (default: 5)'),
  })
  .strict();

export type ToolSearchSnapshotProvider = () => SearchSnapshot;

export function createToolSearchTool(
  getSnapshot: ToolSearchSnapshotProvider,
): ToolSpec<ToolSearchArgs, ToolSearchInvocationResult> {
  return {
    id: TOOL_SEARCH_TOOL_ID,
    description: TOOL_SEARCH_DESCRIPTION,
    schema: ToolSearchSchema,
    parameters: jsonSchemaFromZod(ToolSearchSchema),
    requiresConfirmation: false,
    isReadOnly: true,
    alwaysLoad: true,
    source: 'builtin',
    validate: validateFromZod(ToolSearchSchema),
    async invoke(args, ctx) {
      if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
      const snap = getSnapshot();
      const max = args.max_results ?? 5;
      const hits = search(args.query, snap.deferred, { maxResults: max });
      const matches = hits.map((h) => h.name);
      const total = snap.deferred.length;
      const result: ToolSearchInvocationResult = {
        matches,
        query: args.query,
        total_deferred_tools: total,
        ...(snap.pendingMcpServers !== undefined && snap.pendingMcpServers.length > 0
          ? { pending_mcp_servers: [...snap.pendingMcpServers] }
          : {}),
        ...(matches.length > 0 && !snap.nativeDeferral
          ? { schemaPayload: renderTextSchemas(matches, snap.all) }
          : {}),
      };
      return { ok: true, data: result };
    },
  };
}
