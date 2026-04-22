import { expect, it } from 'vitest';
import { EmbeddingClient } from '@/providers/embeddingClient';
import { liveDescribe, skipIfUnreachable } from './_liveEnv';

liveDescribe(
  'live: EmbeddingClient',
  (getCtx) => {
    it('semantically similar pairs are closer than dissimilar pairs', async (t) => {
      const ctx = getCtx();
      if (skipIfUnreachable(t, ctx)) return;

      const client = new EmbeddingClient({
        endpoint: () => ctx.env.endpoint,
        model: () => ctx.env.embedModel,
        timeoutMs: ctx.env.timeoutMs,
      });

      const pairs: ReadonlyArray<readonly [string, string, 'similar' | 'different']> = [
        ['a dog chasing a ball in the park', 'a puppy playing fetch outdoors', 'similar'],
        [
          'the quick brown fox jumps over the lazy dog',
          'agile canine leaps above a sleeping hound',
          'similar',
        ],
        ['a dog chasing a ball', 'quantum field theory and gauge symmetries', 'different'],
        ['baking a chocolate cake from scratch', 'compiling a Rust binary with cargo', 'different'],
      ];
      const texts = pairs.flatMap(([a, b]) => [a, b]);
      const vectors = await client.embed(texts);
      expect(vectors.length).toBe(texts.length);
      for (const v of vectors) {
        expect(v.length).toBeGreaterThan(0);
      }

      const sims = pairs.map((p, i) => {
        const a = vectors[i * 2];
        const b = vectors[i * 2 + 1];
        if (a === undefined || b === undefined) throw new Error('missing embedding');
        return { kind: p[2], cos: cosine(a, b) };
      });
      const similarMin = Math.min(...sims.filter((s) => s.kind === 'similar').map((s) => s.cos));
      const differentMax = Math.max(
        ...sims.filter((s) => s.kind === 'different').map((s) => s.cos),
      );

      // A weak but meaningful separation: every similar pair scores higher than
      // every dissimilar pair, with at least 0.05 margin.
      expect(similarMin).toBeGreaterThan(differentMax + 0.05);
    }, 180_000);

    it('handles a batch larger than EMBED_BATCH_SIZE (32)', async (t) => {
      const ctx = getCtx();
      if (skipIfUnreachable(t, ctx)) return;

      const client = new EmbeddingClient({
        endpoint: () => ctx.env.endpoint,
        model: () => ctx.env.embedModel,
        timeoutMs: ctx.env.timeoutMs,
      });
      const texts = Array.from({ length: 40 }, (_, i) => `document number ${i + 1}`);
      const vectors = await client.embed(texts);
      expect(vectors.length).toBe(40);
      const first = vectors[0];
      if (first === undefined) throw new Error('empty embeddings');
      const dim = first.length;
      for (const v of vectors) {
        expect(v.length).toBe(dim);
      }
    }, 240_000);
  },
  { requireEmbed: true },
);

function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new Error(`dim mismatch: ${a.length} vs ${b.length}`);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] as number;
    const bi = b[i] as number;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
