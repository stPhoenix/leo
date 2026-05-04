import type { McpResourceContent } from './mcpClient';

export const MCP_RESOURCES_PREAMBLE =
  'The following content was attached from MCP resources. Treat it as user-provided context:';

export interface StagedResource {
  readonly serverId: string;
  readonly uri: string;
  readonly name?: string;
  readonly mimeType?: string;
}

export class ResourcePickerStore {
  private staged: StagedResource[] = [];

  list(): readonly StagedResource[] {
    return this.staged;
  }

  toggle(entry: StagedResource): void {
    const key = keyOf(entry);
    const idx = this.staged.findIndex((s) => keyOf(s) === key);
    if (idx >= 0) this.staged.splice(idx, 1);
    else this.staged.push(entry);
  }

  clear(): void {
    this.staged = [];
  }

  has(entry: Pick<StagedResource, 'serverId' | 'uri'>): boolean {
    const key = keyOf(entry);
    return this.staged.some((s) => keyOf(s) === key);
  }
}

function keyOf(entry: Pick<StagedResource, 'serverId' | 'uri'>): string {
  return `${entry.serverId}|${entry.uri}`;
}

export interface ResolvedResource {
  readonly staged: StagedResource;
  readonly ok: boolean;
  readonly content?: McpResourceContent;
  readonly error?: string;
}

export function composeResourceContent(results: readonly ResolvedResource[]): {
  preamble: string;
  blocks: readonly string[];
  failedUris: readonly string[];
} {
  const blocks: string[] = [];
  const failed: string[] = [];
  for (const r of results) {
    if (!r.ok) {
      failed.push(r.staged.uri);
      continue;
    }
    const content = r.content;
    if (content === undefined) {
      failed.push(r.staged.uri);
      continue;
    }
    const mimeSuffix = content.mimeType !== undefined ? ` (${content.mimeType})` : '';
    const header = `[mcp.resource ${r.staged.serverId}:${content.uri}${mimeSuffix}]`;
    const body = content.text ?? `<binary ${content.blob?.byteLength ?? 0} bytes>`;
    blocks.push(`${header}\n${body}`);
  }
  const preambleParts = [MCP_RESOURCES_PREAMBLE];
  if (failed.length > 0) {
    preambleParts.push(`Note: failed to read ${failed.length} resource(s): ${failed.join(', ')}`);
  }
  return {
    preamble: preambleParts.join('\n'),
    blocks,
    failedUris: failed,
  };
}

export async function resolveStagedResources(
  staged: readonly StagedResource[],
  read: (
    serverId: string,
    uri: string,
    signal?: AbortSignal,
  ) => Promise<{ ok: true; data: McpResourceContent } | { ok: false; error: string }>,
  signal?: AbortSignal,
): Promise<readonly ResolvedResource[]> {
  const out: ResolvedResource[] = [];
  for (const s of staged) {
    if (signal?.aborted === true) {
      out.push({ staged: s, ok: false, error: 'aborted' });
      continue;
    }
    const res = await read(s.serverId, s.uri, signal);
    if (res.ok) {
      out.push({ staged: s, ok: true, content: res.data });
    } else {
      out.push({ staged: s, ok: false, error: res.error });
    }
  }
  return out;
}
