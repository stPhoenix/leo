import { describe, expect, it, vi } from 'vitest';
import { EmbeddingClient } from '@/providers/embeddingClient';
import { ConnectionState } from '@/providers/connectionState';
import { ProviderConnectError } from '@/providers/types';

const ENDPOINT = 'http://127.0.0.1:1234';

describe('EmbeddingClient (AC6, FR-PROV-08)', () => {
  it('delegates to embedDocuments and returns the vectors', async () => {
    const embed = vi.fn(async (texts: string[]) => texts.map((_, i) => [i, i + 1, i + 2]));
    const client = new EmbeddingClient({
      endpoint: () => ENDPOINT,
      model: () => 'embed-model-x',
      embedDocuments: embed,
    });
    const out = await client.embed(['a', 'b']);
    expect(out).toEqual([
      [0, 1, 2],
      [1, 2, 3],
    ]);
    expect(embed).toHaveBeenCalledOnce();
    expect(embed.mock.calls[0]![0]).toEqual(['a', 'b']);
  });

  it('uses its own model fn — chat model changes do not leak in', async () => {
    let modelSeenByEmbed: string | undefined;
    const embed = vi.fn(async (texts: string[]) => {
      modelSeenByEmbed = (embed as unknown as { __model?: string }).__model;
      return texts.map(() => [1]);
    });
    const embeddingModel = { value: 'embed-B' };
    const client = new EmbeddingClient({
      endpoint: () => ENDPOINT,
      model: () => embeddingModel.value,
      embedDocuments: async (texts) => {
        (embed as unknown as { __model?: string }).__model = embeddingModel.value;
        return embed(texts);
      },
    });
    await client.embed(['t']);
    expect(modelSeenByEmbed).toBe('embed-B');
  });

  it('returns [] for empty input without hitting embedDocuments', async () => {
    const embed = vi.fn(async () => []);
    const client = new EmbeddingClient({
      endpoint: () => ENDPOINT,
      model: () => 'm',
      embedDocuments: embed,
    });
    expect(await client.embed([])).toEqual([]);
    expect(embed).not.toHaveBeenCalled();
  });

  it('refuses to call when ConnectionState is unreachable', async () => {
    const conn = new ConnectionState();
    conn.markUnreachable();
    const client = new EmbeddingClient({
      endpoint: () => ENDPOINT,
      model: () => 'm',
      connection: conn,
      embedDocuments: async () => [],
    });
    await expect(client.embed(['t'])).rejects.toBeInstanceOf(ProviderConnectError);
  });

  it('splits > EMBED_BATCH_SIZE input into sub-batches and returns ordered vectors', async () => {
    const requestSizes: number[] = [];
    const embed = vi.fn(async (texts: string[]) => {
      const prefix = (requestSizes.length + 1) * 100;
      requestSizes.push(texts.length);
      return texts.map((_, i) => [prefix + i]);
    });
    const client = new EmbeddingClient({
      endpoint: () => ENDPOINT,
      model: () => 'm',
      embedDocuments: embed,
    });
    const input = Array.from({ length: 70 }, (_, i) => `t-${i}`);
    const out = await client.embed(input);
    expect(out.length).toBe(70);
    expect(out[0]).toEqual([100]);
    expect(out[31]).toEqual([131]);
    expect(out[32]).toEqual([200]);
    expect(out[63]).toEqual([231]);
    expect(out[64]).toEqual([300]);
    expect(out[69]).toEqual([305]);
    expect(requestSizes).toEqual([32, 32, 6]);
  });

  it('retries connection failures up to maxAttempts before failing', async () => {
    let calls = 0;
    const embed = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new ProviderConnectError('boom');
      return [[1, 2, 3]];
    });
    const client = new EmbeddingClient({
      endpoint: () => ENDPOINT,
      model: () => 'm',
      embedDocuments: embed,
      maxAttempts: 4,
      baseBackoffMs: 1,
      maxBackoffMs: 2,
    });
    const out = await client.embed(['a']);
    expect(out).toEqual([[1, 2, 3]]);
    expect(calls).toBe(3);
  });
});
