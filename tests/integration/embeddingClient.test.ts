import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { EmbeddingClient } from '@/providers/embeddingClient';
import { ConnectionState } from '@/providers/connectionState';
import { ProviderConnectError } from '@/providers/types';
import { setupMswServer } from './_mswServer';

const ENDPOINT = 'http://127.0.0.1:1234';
const server = setupMswServer();

describe('EmbeddingClient (AC6, FR-PROV-08)', () => {
  it('POSTs to /v1/embeddings with the embedding model and parses vectors', async () => {
    let receivedBody: unknown;
    server.use(
      http.post(`${ENDPOINT}/v1/embeddings`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({
          data: [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.4, 0.5, 0.6] }],
        });
      }),
    );

    const client = new EmbeddingClient({
      endpoint: () => ENDPOINT,
      model: () => 'embed-model-x',
    });
    const out = await client.embed(['a', 'b']);
    expect(out).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);
    expect(receivedBody).toEqual({ model: 'embed-model-x', input: ['a', 'b'] });
  });

  it('does not share a model with chat — uses its own model fn', async () => {
    let received: { model?: string } | undefined;
    server.use(
      http.post(`${ENDPOINT}/v1/embeddings`, async ({ request }) => {
        received = (await request.json()) as { model?: string };
        return HttpResponse.json({ data: [{ embedding: [1] }] });
      }),
    );

    const chatModel = { value: 'chat-A' };
    const embeddingModel = { value: 'embed-B' };
    const client = new EmbeddingClient({
      endpoint: () => ENDPOINT,
      model: () => embeddingModel.value,
    });
    chatModel.value = 'chat-changed';
    await client.embed(['t']);
    expect(received?.model).toBe('embed-B');
  });

  it('returns [] for empty input without hitting the network', async () => {
    const client = new EmbeddingClient({ endpoint: () => ENDPOINT, model: () => 'm' });
    expect(await client.embed([])).toEqual([]);
  });

  it('refuses to call when ConnectionState is unreachable', async () => {
    const conn = new ConnectionState();
    conn.markUnreachable();
    const client = new EmbeddingClient({
      endpoint: () => ENDPOINT,
      model: () => 'm',
      connection: conn,
    });
    await expect(client.embed(['t'])).rejects.toBeInstanceOf(ProviderConnectError);
  });

  it('splits > EMBED_BATCH_SIZE input into sub-batches and returns ordered vectors', async () => {
    const requestSizes: number[] = [];
    server.use(
      http.post(`${ENDPOINT}/v1/embeddings`, async ({ request }) => {
        const body = (await request.json()) as { input?: string[] };
        const n = body.input?.length ?? 0;
        requestSizes.push(n);
        const prefix = requestSizes.length * 100;
        return HttpResponse.json({
          data: Array.from({ length: n }, (_, i) => ({ embedding: [prefix + i] })),
        });
      }),
    );
    const client = new EmbeddingClient({ endpoint: () => ENDPOINT, model: () => 'm' });
    const input = Array.from({ length: 70 }, (_, i) => `t-${i}`);
    const out = await client.embed(input);
    expect(out.length).toBe(70);
    // First batch of 32 → embedding[0][0] = 100, last of first batch = 131
    expect(out[0]).toEqual([100]);
    expect(out[31]).toEqual([131]);
    // Second batch 32 → 200 + index
    expect(out[32]).toEqual([200]);
    expect(out[63]).toEqual([231]);
    // Third batch 6 → 300 + index
    expect(out[64]).toEqual([300]);
    expect(out[69]).toEqual([305]);
    expect(requestSizes).toEqual([32, 32, 6]);
  });
});
