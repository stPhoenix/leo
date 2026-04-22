import { describe, expect, it, vi } from 'vitest';
import {
  createCustomProvider,
  createOllamaProvider,
  createOpenAIProvider,
  OpenAICompatibleProvider,
} from '@/providers/openAICompatibleProvider';
import type { ProviderChatRequest, StreamEvent } from '@/providers/types';

function makeSseResponse(frames: readonly string[]): Response {
  const body = frames.map((f) => `data: ${f}\n\n`).join('');
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function makeJsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function collect(iter: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

describe('OpenAICompatibleProvider', () => {
  it('createOpenAIProvider sends Authorization: Bearer <key> and hits api.openai.com', async () => {
    const fetchSpy = vi.fn<[string, RequestInit?], Promise<Response>>(async () =>
      makeSseResponse([JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }), '[DONE]']),
    );
    const provider = createOpenAIProvider({
      apiKey: () => 'sk-test',
      fetch: fetchSpy as never,
    });
    const req: ProviderChatRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
    };
    const events = await collect(provider.stream(req, new AbortController().signal));
    expect(events.map((e) => e.type)).toEqual(['token', 'done']);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test');
  });

  it('createOllamaProvider defaults to http://localhost:11434 with no auth header', async () => {
    const fetchSpy = vi.fn<[string, RequestInit?], Promise<Response>>(async () =>
      makeSseResponse(['[DONE]']),
    );
    const provider = createOllamaProvider({ fetch: fetchSpy as never });
    const req: ProviderChatRequest = {
      model: 'llama3',
      messages: [{ role: 'user', content: 'x' }],
    };
    await collect(provider.stream(req, new AbortController().signal));
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('createCustomProvider uses the user-supplied baseURL + arbitrary auth header', async () => {
    const fetchSpy = vi.fn<[string, RequestInit?], Promise<Response>>(async () =>
      makeSseResponse(['[DONE]']),
    );
    const provider = createCustomProvider({
      baseURL: () => 'https://mycloud.example/api',
      authHeader: () => ({ name: 'X-My-Key', value: 'custom-token' }),
      fetch: fetchSpy as never,
    });
    const req: ProviderChatRequest = { model: 'm', messages: [{ role: 'user', content: 'q' }] };
    await collect(provider.stream(req, new AbortController().signal));
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://mycloud.example/api/v1/chat/completions');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['X-My-Key']).toBe('custom-token');
  });

  it('emits token + usage + done in the expected order from an OpenAI-shaped stream', async () => {
    const frames = [
      JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] }),
      JSON.stringify({ choices: [{ delta: { content: ' world' } }] }),
      JSON.stringify({ usage: { prompt_tokens: 5, completion_tokens: 10 } }),
      '[DONE]',
    ];
    const provider = new OpenAICompatibleProvider({
      id: 'test',
      endpoint: () => 'https://api.example.com',
      fetch: async () => makeSseResponse(frames),
    });
    const events = await collect(
      provider.stream(
        { model: 'gpt-x', messages: [{ role: 'user', content: 'q' }] },
        new AbortController().signal,
      ),
    );
    expect(events.map((e) => e.type)).toEqual(['token', 'token', 'usage', 'done']);
    const usage = events.find((e) => e.type === 'usage')!;
    if (usage.type === 'usage') {
      expect(usage.input).toBe(5);
      expect(usage.output).toBe(10);
    }
  });

  it('listModels returns parsed ids from the OpenAI-shaped /v1/models', async () => {
    const provider = new OpenAICompatibleProvider({
      id: 'test',
      endpoint: () => 'https://api.example.com',
      fetch: async () =>
        makeJsonResponse({ data: [{ id: 'gpt-4' }, { id: 'gpt-4o' }, { notId: 'x' }] }),
    });
    const models = await provider.listModels();
    expect(models.map((m) => m.id)).toEqual(['gpt-4', 'gpt-4o']);
  });

  it('respects AbortSignal thrown before fetch', async () => {
    const ctl = new AbortController();
    ctl.abort(new Error('user-cancel'));
    const provider = new OpenAICompatibleProvider({
      id: 'test',
      endpoint: () => 'https://api.example.com',
      fetch: async (_url, init) => {
        if ((init as RequestInit).signal?.aborted === true) throw new Error('AbortError');
        return makeSseResponse(['[DONE]']);
      },
    });
    await expect(
      collect(
        provider.stream({ model: 'x', messages: [{ role: 'user', content: 'q' }] }, ctl.signal),
      ),
    ).rejects.toThrow(/cancel/);
  });

  it('surfaces ProviderConnectError on non-2xx status', async () => {
    const provider = new OpenAICompatibleProvider({
      id: 'test',
      endpoint: () => 'https://api.example.com',
      fetch: async () => new Response('err', { status: 500 }),
    });
    await expect(
      collect(
        provider.stream(
          { model: 'x', messages: [{ role: 'user', content: 'q' }] },
          new AbortController().signal,
        ),
      ),
    ).rejects.toThrow(/HTTP 500/);
  });
});
