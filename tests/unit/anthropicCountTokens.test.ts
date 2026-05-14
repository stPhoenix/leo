import { describe, expect, it, vi } from 'vitest';
import {
  anthropicCountTokens,
  AnthropicCountTokensError,
  ANTHROPIC_COUNT_TOKENS_PATH,
  ANTHROPIC_VERSION,
  buildRequestBody,
} from '@/providers/anthropicCountTokens';
import type { ProviderChatRequest } from '@/providers/types';
import type { FetchLike } from '@/platform/obsidianFetch';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function reqMessages(): ProviderChatRequest {
  return {
    model: 'claude-opus-4-7',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object', properties: {} },
        },
      },
    ],
  };
}

describe('buildRequestBody', () => {
  it('extracts system prompts, converts messages, includes tools', () => {
    const body = buildRequestBody(reqMessages());
    expect(body.model).toBe('claude-opus-4-7');
    expect(body.system).toBe('You are a helpful assistant.');
    expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
    expect(body.tools).toEqual([
      {
        name: 'get_weather',
        description: 'Get weather',
        input_schema: { type: 'object', properties: {} },
      },
    ]);
  });

  it('emits tool messages as user-role tool_result blocks', () => {
    const body = buildRequestBody({
      model: 'claude-haiku-4-5-20251001',
      messages: [
        { role: 'user', content: 'q' },
        { role: 'tool', toolCallId: 't1', name: 'get_weather', content: '{"temp": 70}' },
      ],
    });
    expect(body.messages).toEqual([
      { role: 'user', content: 'q' },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"temp": 70}' }],
      },
    ]);
  });

  it('passes structured ContentBlocks (image, document, tool_use, tool_result)', () => {
    const body = buildRequestBody({
      model: 'claude-sonnet-4-6',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'see this' },
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
            },
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: 'BBBB' },
            },
          ],
        },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'u1', name: 'search', input: { q: 'x' } }],
        },
      ],
    });
    expect(body.messages[0]?.content).toEqual([
      { type: 'text', text: 'see this' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'BBBB' } },
    ]);
    expect(body.messages[1]?.content).toEqual([
      { type: 'tool_use', id: 'u1', name: 'search', input: { q: 'x' } },
    ]);
  });
});

describe('anthropicCountTokens', () => {
  it('POSTs to /v1/messages/count_tokens with required headers and parses input_tokens', async () => {
    const fetchImpl = vi.fn<Parameters<FetchLike>, ReturnType<FetchLike>>(async (url, init) => {
      expect(url).toBe(`https://api.anthropic.com${ANTHROPIC_COUNT_TOKENS_PATH}`);
      expect(init?.method).toBe('POST');
      const headers = init?.headers as Record<string, string>;
      expect(headers['x-api-key']).toBe('test-key');
      expect(headers['anthropic-version']).toBe(ANTHROPIC_VERSION);
      expect(headers['content-type']).toBe('application/json');
      const parsed = JSON.parse(init?.body as string);
      expect(parsed.model).toBe('claude-opus-4-7');
      expect(parsed.messages).toBeDefined();
      return jsonResponse({ input_tokens: 1234 });
    });
    const tokens = await anthropicCountTokens(reqMessages(), {
      apiKey: 'test-key',
      fetchImpl,
    });
    expect(tokens).toBe(1234);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('honors custom endpoint, stripping trailing slash', async () => {
    const fetchImpl = vi.fn<Parameters<FetchLike>, ReturnType<FetchLike>>(async (url) => {
      expect(url).toBe(`https://proxy.example.com${ANTHROPIC_COUNT_TOKENS_PATH}`);
      return jsonResponse({ input_tokens: 7 });
    });
    const tokens = await anthropicCountTokens(reqMessages(), {
      apiKey: 'k',
      endpoint: 'https://proxy.example.com/',
      fetchImpl,
    });
    expect(tokens).toBe(7);
  });

  it('throws AnthropicCountTokensError with status 429 on rate limit', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ error: 'rate' }, 429);
    await expect(
      anthropicCountTokens(reqMessages(), { apiKey: 'k', fetchImpl }),
    ).rejects.toMatchObject({
      name: 'AnthropicCountTokensError',
      status: 429,
    });
  });

  it('throws on non-2xx response with body in message', async () => {
    const fetchImpl: FetchLike = async () =>
      new Response('boom', {
        status: 500,
        headers: { 'content-type': 'text/plain' },
      });
    await expect(anthropicCountTokens(reqMessages(), { apiKey: 'k', fetchImpl })).rejects.toThrow(
      /HTTP 500.*boom/,
    );
  });

  it('throws when response missing input_tokens', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ wrong: true });
    await expect(anthropicCountTokens(reqMessages(), { apiKey: 'k', fetchImpl })).rejects.toThrow(
      'missing_input_tokens',
    );
  });

  it('throws AnthropicCountTokensError when fetch itself rejects', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('network down');
    };
    await expect(
      anthropicCountTokens(reqMessages(), { apiKey: 'k', fetchImpl }),
    ).rejects.toBeInstanceOf(AnthropicCountTokensError);
  });
});
