import { describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from '@/providers/anthropicProvider';
import type { StreamEvent } from '@/providers/types';

function makeSseResponse(frames: readonly string[]): Response {
  const body = frames.map((f) => `data: ${f}\n\n`).join('');
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

async function collect(iter: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

describe('AnthropicProvider', () => {
  it('emits token deltas + usage + done from Anthropic SSE shape', async () => {
    const frames = [
      JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 12 } } }),
      JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } }),
      JSON.stringify({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: ' world' },
      }),
      JSON.stringify({ type: 'message_delta', usage: { output_tokens: 20 } }),
      JSON.stringify({ type: 'message_stop' }),
    ];
    const provider = new AnthropicProvider({
      apiKey: () => 'sk-ant',
      fetch: async () => makeSseResponse(frames),
    });
    const events = await collect(
      provider.stream(
        { model: 'claude-opus', messages: [{ role: 'user', content: 'q' }] },
        new AbortController().signal,
      ),
    );
    expect(events.map((e) => e.type)).toEqual(['token', 'token', 'usage', 'done']);
    const usage = events.find((e) => e.type === 'usage')!;
    if (usage.type === 'usage') {
      expect(usage.input).toBe(12);
      expect(usage.output).toBe(20);
    }
  });

  it('splits system messages from the user/assistant transcript per Anthropic contract', async () => {
    const fetchSpy = vi.fn<[string, RequestInit?], Promise<Response>>(async () =>
      makeSseResponse([JSON.stringify({ type: 'message_stop' })]),
    );
    const provider = new AnthropicProvider({
      apiKey: () => 'sk-ant',
      fetch: fetchSpy as never,
    });
    await collect(
      provider.stream(
        {
          model: 'claude',
          messages: [
            { role: 'system', content: 'You are helpful.' },
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'hello' },
          ],
        },
        new AbortController().signal,
      ),
    );
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string) as {
      system?: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.system).toBe('You are helpful.');
    expect(body.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('sends x-api-key + anthropic-version headers (not Authorization: Bearer)', async () => {
    const fetchSpy = vi.fn<[string, RequestInit?], Promise<Response>>(async () =>
      makeSseResponse([JSON.stringify({ type: 'message_stop' })]),
    );
    const provider = new AnthropicProvider({
      apiKey: () => 'key-abc',
      anthropicVersion: '2026-01-01',
      fetch: fetchSpy as never,
    });
    await collect(
      provider.stream(
        { model: 'x', messages: [{ role: 'user', content: 'q' }] },
        new AbortController().signal,
      ),
    );
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('key-abc');
    expect(headers['anthropic-version']).toBe('2026-01-01');
    expect(headers.Authorization).toBeUndefined();
  });

  it('listModels returns bundled default list', async () => {
    const provider = new AnthropicProvider({ apiKey: () => 'k' });
    const models = await provider.listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.id.startsWith('claude-'))).toBe(true);
  });

  it('listModels respects a user-supplied bundledModels list', async () => {
    const provider = new AnthropicProvider({
      apiKey: () => 'k',
      bundledModels: ['custom-anthropic-model'],
    });
    const models = await provider.listModels();
    expect(models).toEqual([{ id: 'custom-anthropic-model' }]);
  });
});
