import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { LMStudioProvider } from '@/providers/lmStudioProvider';
import type { StreamEvent } from '@/providers/types';
import { ProviderConnectError } from '@/providers/types';
import { chatChunk, chatUsageChunk, SSE_DONE, setupMswServer } from './_mswServer';

const ENDPOINT = 'http://127.0.0.1:1234';
const server = setupMswServer();

function sseResponse(parts: readonly string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of parts) controller.enqueue(enc.encode(p));
      controller.close();
    },
  });
  return new HttpResponse(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

async function collect(it: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}

describe('LMStudioProvider.stream — SSE token order (AC1, FR-PROV-01, FR-PROV-03)', () => {
  it('parses tokens, usage, and [DONE] in order', async () => {
    server.use(
      http.post(`${ENDPOINT}/v1/chat/completions`, () =>
        sseResponse([chatChunk('Hello'), chatChunk(' world'), chatUsageChunk(8, 2), SSE_DONE]),
      ),
    );

    const provider = new LMStudioProvider({ endpoint: () => ENDPOINT });
    const events = await collect(
      provider.stream(
        { model: 'm1', messages: [{ role: 'user', content: 'hi' }] },
        new AbortController().signal,
      ),
    );

    expect(events).toEqual([
      { type: 'token', text: 'Hello' },
      { type: 'token', text: ' world' },
      { type: 'usage', input: 8, output: 2 },
      { type: 'done' },
    ]);
  });

  it('forwards model + messages + stream:true to the chat endpoint', async () => {
    let body: unknown;
    server.use(
      http.post(`${ENDPOINT}/v1/chat/completions`, async ({ request }) => {
        body = await request.json();
        return sseResponse([SSE_DONE]);
      }),
    );

    const provider = new LMStudioProvider({ endpoint: () => ENDPOINT });
    await collect(
      provider.stream(
        {
          model: 'm-chat',
          messages: [
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'hi' },
          ],
          temperature: 0.2,
          maxTokens: 64,
        },
        new AbortController().signal,
      ),
    );

    expect(body).toEqual({
      model: 'm-chat',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
      stream: true,
      temperature: 0.2,
      max_tokens: 64,
    });
  });

  it('terminates cleanly when caller aborts mid-stream', async () => {
    server.use(
      http.post(`${ENDPOINT}/v1/chat/completions`, () => {
        const enc = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(enc.encode(chatChunk('A')));
            await new Promise((r) => setTimeout(r, 50));
            controller.enqueue(enc.encode(chatChunk('B')));
            controller.close();
          },
        });
        return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } });
      }),
    );

    const provider = new LMStudioProvider({ endpoint: () => ENDPOINT });
    const ctl = new AbortController();
    const events: StreamEvent[] = [];

    const iter = provider.stream(
      { model: 'm', messages: [{ role: 'user', content: 'x' }] },
      ctl.signal,
    );
    let abortSeen: unknown = null;
    try {
      for await (const ev of iter) {
        events.push(ev);
        if (ev.type === 'token') ctl.abort();
      }
    } catch (err) {
      abortSeen = err;
    }
    expect(events[0]).toEqual({ type: 'token', text: 'A' });
    // Either iteration breaks cleanly or surfaces the abort — both acceptable.
    if (abortSeen !== null) {
      expect(String(abortSeen)).toMatch(/abort/i);
    }
  });
});

describe('LMStudioProvider.listModels (AC2, FR-PROV-02)', () => {
  it('returns parsed model ids from /v1/models', async () => {
    server.use(
      http.get(`${ENDPOINT}/v1/models`, () =>
        HttpResponse.json({
          data: [{ id: 'llama-3-8b' }, { id: 'qwen-7b' }, { id: null }, { not_id: 'skip' }],
        }),
      ),
    );

    const provider = new LMStudioProvider({ endpoint: () => ENDPOINT });
    const models = await provider.listModels();
    expect(models).toEqual([{ id: 'llama-3-8b' }, { id: 'qwen-7b' }]);
  });

  it('throws ProviderConnectError on non-2xx', async () => {
    server.use(http.get(`${ENDPOINT}/v1/models`, () => new HttpResponse(null, { status: 500 })));
    const provider = new LMStudioProvider({ endpoint: () => ENDPOINT });
    await expect(provider.listModels()).rejects.toBeInstanceOf(ProviderConnectError);
  });
});

describe('LMStudioProvider — connection failures', () => {
  it('throws ProviderConnectError when chat endpoint returns non-2xx pre-stream', async () => {
    server.use(
      http.post(`${ENDPOINT}/v1/chat/completions`, () => new HttpResponse('nope', { status: 502 })),
    );
    const provider = new LMStudioProvider({ endpoint: () => ENDPOINT });
    await expect(
      collect(
        provider.stream(
          { model: 'm', messages: [{ role: 'user', content: 'x' }] },
          new AbortController().signal,
        ),
      ),
    ).rejects.toBeInstanceOf(ProviderConnectError);
  });
});
