import { describe, expect, it } from 'vitest';
import {
  applyBoosts,
  DEFAULT_BOOST_WEIGHTS,
  GRAPH_BOOST_1H,
  GRAPH_BOOST_2H,
  TAG_SHARED_BOOST,
} from '@/rag/scorer';

function ctx(
  override: Partial<Parameters<typeof applyBoosts>[0]>,
): Parameters<typeof applyBoosts>[0] {
  return {
    rawScore: 0.5,
    chunkPath: 'a.md',
    chunkTags: new Set<string>(),
    oneHop: new Set<string>(),
    twoHop: new Set<string>(),
    activeTags: new Set<string>(),
    weights: DEFAULT_BOOST_WEIGHTS,
    ...override,
  };
}

describe('Scorer.applyBoosts', () => {
  it('no boost: empty sets → rawScore · 1.0 + 0 = rawScore', () => {
    expect(applyBoosts(ctx({ rawScore: 0.5 }))).toBe(0.5);
    expect(applyBoosts(ctx({ rawScore: 0 }))).toBe(0);
  });

  it('1-hop only: rawScore · 1.5', () => {
    const out = applyBoosts(ctx({ rawScore: 0.5, oneHop: new Set(['a.md']) }));
    expect(out).toBeCloseTo(0.75, 10);
  });

  it('2-hop only: rawScore · 1.2', () => {
    const out = applyBoosts(ctx({ rawScore: 0.5, twoHop: new Set(['a.md']) }));
    expect(out).toBeCloseTo(0.6, 10);
  });

  it('1-hop beats 2-hop when both present (no compound)', () => {
    const out = applyBoosts(
      ctx({
        rawScore: 0.5,
        oneHop: new Set(['a.md']),
        twoHop: new Set(['a.md']),
      }),
    );
    expect(out).toBeCloseTo(0.5 * 1.5, 10);
  });

  it('tag-shared only: rawScore · 1.0 + 0.1 · rawScore = rawScore · 1.1', () => {
    const out = applyBoosts(
      ctx({
        rawScore: 0.5,
        chunkTags: new Set(['x']),
        activeTags: new Set(['x']),
      }),
    );
    expect(out).toBeCloseTo(0.5 * 1.1, 10);
  });

  it('1-hop + tag-shared: rawScore · 1.5 + 0.1 · rawScore = rawScore · 1.6', () => {
    const out = applyBoosts(
      ctx({
        rawScore: 0.5,
        oneHop: new Set(['a.md']),
        chunkTags: new Set(['x']),
        activeTags: new Set(['x']),
      }),
    );
    expect(out).toBeCloseTo(0.5 * 1.6, 10);
  });

  it('2-hop + tag-shared: rawScore · 1.2 + 0.1 · rawScore = rawScore · 1.3', () => {
    const out = applyBoosts(
      ctx({
        rawScore: 0.5,
        twoHop: new Set(['a.md']),
        chunkTags: new Set(['x']),
        activeTags: new Set(['x']),
      }),
    );
    expect(out).toBeCloseTo(0.5 * 1.3, 10);
  });

  it('tag disjoint: no additive applied', () => {
    const out = applyBoosts(
      ctx({
        rawScore: 0.5,
        chunkTags: new Set(['foo']),
        activeTags: new Set(['bar']),
      }),
    );
    expect(out).toBeCloseTo(0.5, 10);
  });

  it('default multipliers match the SRS 1.5 / 1.2 / 1.1 constants', () => {
    expect(GRAPH_BOOST_1H).toBe(1.5);
    expect(GRAPH_BOOST_2H).toBe(1.2);
    expect(TAG_SHARED_BOOST).toBe(1.1);
  });

  it('custom weights: 2.0 / 1.4 / 1.2 override the defaults', () => {
    const out = applyBoosts(
      ctx({
        rawScore: 1,
        oneHop: new Set(['a.md']),
        chunkTags: new Set(['x']),
        activeTags: new Set(['x']),
        weights: { oneHop: 2.0, twoHop: 1.4, tagShared: 1.2 },
      }),
    );
    // 1 * 2.0 + 0.2 * 1 = 2.2
    expect(out).toBeCloseTo(2.2, 10);
  });

  it('rawScore = 0 still applies boost cleanly (0 · 1.5 + 0 = 0)', () => {
    const out = applyBoosts(
      ctx({
        rawScore: 0,
        oneHop: new Set(['a.md']),
        chunkTags: new Set(['x']),
        activeTags: new Set(['x']),
      }),
    );
    expect(out).toBe(0);
  });
});
