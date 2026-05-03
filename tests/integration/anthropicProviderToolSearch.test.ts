import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { AnthropicProvider } from '@/providers/anthropicProvider';
import type { OpenAITool, ProviderChatRequest } from '@/providers/types';

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

function installFetchSpy(): {
  captured: CapturedRequest[];
  restore: () => void;
} {
  const captured: CapturedRequest[] = [];
  const original = globalThis.fetch;
  const fakeFetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    captured.push({ url, init: init ?? {} });
    const sse =
      'event: message_start\n' +
      `data: ${JSON.stringify({
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-4-7',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      })}\n\n` +
      'event: content_block_start\n' +
      `data: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n` +
      'event: content_block_delta\n' +
      `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } })}\n\n` +
      'event: content_block_stop\n' +
      `data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n` +
      'event: message_delta\n' +
      `data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } })}\n\n` +
      'event: message_stop\n' +
      `data: ${JSON.stringify({ type: 'message_stop' })}\n\n`;
    return new Response(sse, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  });
  globalThis.fetch = fakeFetch as unknown as typeof fetch;
  return {
    captured,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function tool(name: string, deferLoading = false): OpenAITool {
  return {
    type: 'function' as const,
    function: { name, description: `desc ${name}`, parameters: { type: 'object', properties: {} } },
    ...(deferLoading ? { defer_loading: true } : {}),
  };
}

describe('AnthropicProvider + ToolSearch wire shape', () => {
  let spy: ReturnType<typeof installFetchSpy>;

  beforeEach(() => {
    spy = installFetchSpy();
  });
  afterEach(() => {
    spy.restore();
  });

  it('sets anthropic-beta header when providerHints.betas is supplied', async () => {
    const provider = new AnthropicProvider({ apiKey: () => 'sk-test' });
    const req: ProviderChatRequest = {
      model: 'claude-opus-4-7',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [tool('mcp.x.y', true)],
      providerHints: { betas: ['advanced-tool-use-2025-11-20'], nativeDeferral: true },
    };
    const ctrl = new AbortController();
    for await (const _ of provider.stream(req, ctrl.signal)) {
      // drain
    }
    expect(spy.captured.length).toBeGreaterThan(0);
    const headers = spy.captured[0]!.init.headers as Headers;
    const beta = headers.get('anthropic-beta');
    expect(beta).not.toBeNull();
    expect(beta).toContain('advanced-tool-use-2025-11-20');
  });

  it('outgoing body carries defer_loading: true on flagged tools', async () => {
    const provider = new AnthropicProvider({ apiKey: () => 'sk-test' });
    const req: ProviderChatRequest = {
      model: 'claude-opus-4-7',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [tool('Read', false), tool('mcp.deferred.thing', true)],
      providerHints: { betas: ['advanced-tool-use-2025-11-20'], nativeDeferral: true },
    };
    const ctrl = new AbortController();
    for await (const _ of provider.stream(req, ctrl.signal)) {
      // drain
    }
    expect(spy.captured.length).toBeGreaterThan(0);
    const body = JSON.parse(spy.captured[0]!.init.body as string) as {
      tools?: { name: string; defer_loading?: boolean }[];
    };
    expect(body.tools).toBeDefined();
    const deferred = body.tools!.filter((t) => t.defer_loading === true).map((t) => t.name);
    expect(deferred).toContain('mcp.deferred.thing');
    expect(deferred).not.toContain('Read');
  });

  it('no anthropic-beta when providerHints absent', async () => {
    const provider = new AnthropicProvider({ apiKey: () => 'sk-test' });
    const req: ProviderChatRequest = {
      model: 'claude-opus-4-7',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [tool('Read', false)],
    };
    const ctrl = new AbortController();
    for await (const _ of provider.stream(req, ctrl.signal)) {
      // drain
    }
    const headers = spy.captured[0]!.init.headers as Headers;
    expect(headers.get('anthropic-beta')).toBeNull();
  });
});
