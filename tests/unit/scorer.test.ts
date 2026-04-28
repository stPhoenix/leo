import { describe, expect, it } from 'vitest';
import { cosine } from '@/rag/scorer';

describe('Scorer.cosine', () => {
  it('returns 1 for colinear vectors', () => {
    expect(cosine([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 10);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });

  it('returns -1 for anti-parallel vectors', () => {
    expect(cosine([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1, 10);
  });

  it('guards against zero-vector inputs (returns 0, never NaN)', () => {
    expect(cosine([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosine([1, 2, 3], [0, 0, 0])).toBe(0);
    expect(cosine([0], [0])).toBe(0);
  });

  it('returns 0 for length-mismatch or empty inputs', () => {
    expect(cosine([1, 2], [1, 2, 3])).toBe(0);
    expect(cosine([], [])).toBe(0);
  });

  it('monotonic in similarity — closer vectors score higher', () => {
    const q = [1, 0, 0];
    const near = [0.9, 0.1, 0];
    const far = [0.1, 0.9, 0];
    expect(cosine(q, near)).toBeGreaterThan(cosine(q, far));
  });
});
