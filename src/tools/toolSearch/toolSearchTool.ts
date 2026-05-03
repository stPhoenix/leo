import { z } from 'zod';
import type { ToolSpec } from '@/tools/types';
import { jsonSchemaFromZod, validateFromZod } from '@/tools/zodAdapter';
import { search } from './searchAlgorithm';
import { renderTextSchemas } from './renderTextSchemas';
import type { SearchSnapshot, ToolSearchInvocationResult } from './types';

export const TOOL_SEARCH_TOOL_ID = 'ToolSearch';

const TOOL_SEARCH_DESCRIPTION = `Fetches full schema definitions for deferred tools so they can be called.

Deferred tools appear by name in <system-reminder> messages. Until fetched, only the name is known — there is no parameter schema, so the tool cannot be invoked. This tool takes a query, matches it against the deferred tool list, and returns the matched tools' complete JSONSchema definitions inside a <functions> block. Once a tool's schema appears in that result, it is callable exactly like any tool defined at the top of the prompt.

Result format: each matched tool appears as one <function>{"description": "...", "name": "...", "parameters": {...}}</function> line inside the <functions> block — the same encoding as the tool list at the top of the prompt.

Query forms:
- "select:Read,Edit,Grep" — fetch these exact tools by name
- "notebook jupyter" — keyword search, up to max_results best matches
- "+slack send" — require "slack" in the name, rank by remaining terms`;

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
