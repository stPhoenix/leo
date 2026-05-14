import type { ContentBlock, OpenAITool, ProviderChatRequest } from './types';
import type { FetchLike } from '@/platform/obsidianFetch';
import { sanitizeToolNames } from './anthropicProvider';

export const ANTHROPIC_COUNT_TOKENS_PATH = '/v1/messages/count_tokens';
export const ANTHROPIC_VERSION = '2023-06-01';

export interface CountTokensOptions {
  readonly apiKey: string;
  readonly endpoint?: string;
  readonly fetchImpl: FetchLike;
  readonly signal?: AbortSignal;
}

export class AnthropicCountTokensError extends Error {
  override readonly name = 'AnthropicCountTokensError';
  constructor(
    message: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options as ErrorOptions | undefined);
  }
}

export async function anthropicCountTokens(
  req: ProviderChatRequest,
  opts: CountTokensOptions,
): Promise<number> {
  const url = resolveUrl(opts.endpoint);
  const body = buildRequestBody(req);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': opts.apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
  };
  let response: Response;
  try {
    response = await opts.fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });
  } catch (err) {
    throw new AnthropicCountTokensError(
      err instanceof Error ? err.message : String(err),
      undefined,
      { cause: err },
    );
  }
  if (response.status === 429) {
    throw new AnthropicCountTokensError('rate_limited', 429);
  }
  if (response.status < 200 || response.status >= 300) {
    const text = await safeText(response);
    throw new AnthropicCountTokensError(
      `count_tokens HTTP ${response.status}: ${text.slice(0, 200)}`,
      response.status,
    );
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (err) {
    throw new AnthropicCountTokensError('invalid_json', response.status, { cause: err });
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new AnthropicCountTokensError('invalid_response_shape', response.status);
  }
  const inputTokens = (parsed as { input_tokens?: unknown }).input_tokens;
  if (typeof inputTokens !== 'number' || !Number.isFinite(inputTokens)) {
    throw new AnthropicCountTokensError('missing_input_tokens', response.status);
  }
  return inputTokens;
}

interface AnthropicRequestBody {
  readonly model: string;
  readonly messages: readonly AnthropicApiMessage[];
  readonly system?: string;
  readonly tools?: readonly AnthropicApiTool[];
}

interface AnthropicApiMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string | readonly AnthropicContentBlock[];
}

type AnthropicContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'image';
      readonly source: {
        readonly type: 'base64';
        readonly media_type: string;
        readonly data: string;
      };
    }
  | {
      readonly type: 'document';
      readonly source: {
        readonly type: 'base64';
        readonly media_type: string;
        readonly data: string;
      };
    }
  | {
      readonly type: 'tool_use';
      readonly id: string;
      readonly name: string;
      readonly input: unknown;
    }
  | {
      readonly type: 'tool_result';
      readonly tool_use_id: string;
      readonly content: string | readonly { readonly type: 'text'; readonly text: string }[];
      readonly is_error?: boolean;
    }
  | { readonly type: 'thinking'; readonly thinking: string; readonly signature?: string };

interface AnthropicApiTool {
  readonly name: string;
  readonly description: string;
  readonly input_schema: unknown;
}

export function buildRequestBody(req: ProviderChatRequest): AnthropicRequestBody {
  const systemParts: string[] = [];
  const apiMessages: AnthropicApiMessage[] = [];
  for (const m of req.messages) {
    if (m.role === 'system') {
      systemParts.push(typeof m.content === 'string' ? m.content : flattenBlocksToText(m.content));
      continue;
    }
    if (m.role === 'tool') {
      const text = typeof m.content === 'string' ? m.content : flattenBlocksToText(m.content);
      apiMessages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.toolCallId ?? 'unknown',
            content: text,
          },
        ],
      });
      continue;
    }
    const apiRole: 'user' | 'assistant' = m.role === 'assistant' ? 'assistant' : 'user';
    if (typeof m.content === 'string') {
      apiMessages.push({ role: apiRole, content: m.content });
      continue;
    }
    const blocks = m.content
      .map(toAnthropicBlock)
      .filter((b): b is AnthropicContentBlock => b !== null);
    if (blocks.length === 0) continue;
    apiMessages.push({ role: apiRole, content: blocks });
  }
  const body: AnthropicRequestBody & {
    system?: string;
    tools?: readonly AnthropicApiTool[];
  } = {
    model: req.model,
    messages: apiMessages,
  };
  if (systemParts.length > 0) body.system = systemParts.join('\n\n');
  if (req.tools !== undefined && req.tools.length > 0) {
    body.tools = sanitizeToolNames(req.tools).tools.map(toApiTool);
  }
  return body;
}

function toApiTool(t: OpenAITool): AnthropicApiTool {
  return {
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  };
}

function toAnthropicBlock(b: ContentBlock): AnthropicContentBlock | null {
  switch (b.type) {
    case 'text':
      return { type: 'text', text: b.text };
    case 'thinking':
      return b.signature !== undefined
        ? { type: 'thinking', thinking: b.thinking, signature: b.signature }
        : { type: 'thinking', thinking: b.thinking };
    case 'image':
      return { type: 'image', source: { ...b.source } };
    case 'document':
      return { type: 'document', source: { ...b.source } };
    case 'tool_use':
      return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
    case 'tool_result': {
      const content =
        typeof b.content === 'string'
          ? b.content
          : b.content.map((inner) =>
              inner.type === 'text'
                ? ({ type: 'text', text: inner.text } as const)
                : inner.type === 'tool_reference'
                  ? ({ type: 'text', text: inner.tool_name } as const)
                  : ({ type: 'text', text: `[MCP UI: ${inner.uri}]` } as const),
            );
      return b.is_error === true
        ? { type: 'tool_result', tool_use_id: b.tool_use_id, content, is_error: true }
        : { type: 'tool_result', tool_use_id: b.tool_use_id, content };
    }
    case 'tool_reference':
      return { type: 'text', text: b.tool_name };
    case 'slash_expanded':
      return { type: 'text', text: b.expandedBody };
    case 'mcp_ui':
      return { type: 'text', text: `[MCP UI: ${b.uri}]` };
    case 'attachment_chip':
      return null;
    case 'redacted_thinking':
      return null;
  }
}

function flattenBlocksToText(blocks: readonly ContentBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.type === 'text') parts.push(b.text);
    else if (b.type === 'thinking') parts.push(b.thinking);
    else if (b.type === 'tool_reference') parts.push(b.tool_name);
    else if (b.type === 'slash_expanded') parts.push(b.expandedBody);
  }
  return parts.join('');
}

function resolveUrl(endpoint: string | undefined): string {
  const base =
    endpoint !== undefined && endpoint.length > 0
      ? endpoint.replace(/\/+$/, '')
      : 'https://api.anthropic.com';
  return `${base}${ANTHROPIC_COUNT_TOKENS_PATH}`;
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
