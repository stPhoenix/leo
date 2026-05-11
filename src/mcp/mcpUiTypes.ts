export const MCP_UI_URI_PREFIX = 'ui://';

export const MCP_UI_HTML_MIME = 'text/html';
export const MCP_UI_REMOTE_DOM_MIME = 'application/vnd.mcp-ui.remote-dom+javascript';

export const MCP_UI_MIMETYPES: readonly string[] = [MCP_UI_HTML_MIME, MCP_UI_REMOTE_DOM_MIME];

export interface McpUiResource {
  readonly uri: string;
  readonly mimeType: string;
  readonly html: string;
}

export interface McpUiExtractResult {
  readonly textParts: readonly string[];
  readonly uiResources: readonly McpUiResource[];
}

interface RawResourceContent {
  readonly type: 'resource';
  readonly resource: {
    readonly uri?: unknown;
    readonly mimeType?: unknown;
    readonly text?: unknown;
    readonly blob?: unknown;
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isUiMimeType(mime: string): boolean {
  return MCP_UI_MIMETYPES.includes(mime);
}

function isUiUri(uri: string): boolean {
  return uri.startsWith(MCP_UI_URI_PREFIX);
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function parseResource(item: RawResourceContent): McpUiResource | undefined {
  const uri = asString(item.resource.uri);
  const mimeType = asString(item.resource.mimeType) ?? MCP_UI_HTML_MIME;
  const text = asString(item.resource.text);
  if (uri === undefined || text === undefined) return undefined;
  if (!isUiUri(uri) && !isUiMimeType(mimeType)) return undefined;
  return { uri, mimeType, html: text };
}

export function extractMcpUiResources(data: unknown): McpUiExtractResult {
  const textParts: string[] = [];
  const uiResources: McpUiResource[] = [];
  if (!isRecord(data)) return { textParts, uiResources };
  const content = data.content;
  if (!Array.isArray(content)) return { textParts, uiResources };
  for (const item of content) {
    if (!isRecord(item)) continue;
    const type = item.type;
    if (type === 'text' && typeof item.text === 'string') {
      textParts.push(item.text);
      continue;
    }
    if (type === 'resource' && isRecord(item.resource)) {
      const parsed = parseResource({ type: 'resource', resource: item.resource });
      if (parsed !== undefined) uiResources.push(parsed);
    }
  }
  return { textParts, uiResources };
}

export function hasMcpUiResources(data: unknown): boolean {
  return extractMcpUiResources(data).uiResources.length > 0;
}
