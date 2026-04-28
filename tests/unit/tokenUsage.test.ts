import { describe, expect, it } from 'vitest';
import { computeTokenUsage, estimateTokensFromChars } from '@/chat/tokenUsage';

describe('estimateTokensFromChars (len/4 boundary values)', () => {
  it('returns 0 for empty strings', () => {
    expect(estimateTokensFromChars(0)).toBe(0);
  });

  it('returns 1 for a single character', () => {
    expect(estimateTokensFromChars(1)).toBe(1);
  });

  it('returns 1 for exactly 4 characters', () => {
    expect(estimateTokensFromChars(4)).toBe(1);
  });

  it('returns 2 for 5 characters (crosses the /4 boundary)', () => {
    expect(estimateTokensFromChars(5)).toBe(2);
  });

  it('clamps negative inputs to 0', () => {
    expect(estimateTokensFromChars(-10)).toBe(0);
  });
});

describe('computeTokenUsage', () => {
  it('uses provider-supplied input/output verbatim when both present', () => {
    const u = computeTokenUsage({
      promptChars: 12,
      outputChars: 20,
      providerInput: 100,
      providerOutput: 200,
    });
    expect(u).toEqual({ input: 100, output: 200, total: 300 });
  });

  it('falls back to len/4 when provider omits both fields and marks them estimated', () => {
    const u = computeTokenUsage({
      promptChars: 20,
      outputChars: 16,
    });
    expect(u).toEqual({
      input: 5,
      output: 4,
      total: 9,
      estimatedInput: true,
      estimatedOutput: true,
    });
  });

  it('mixes provider value with fallback when only input is missing', () => {
    const u = computeTokenUsage({
      promptChars: 20,
      outputChars: 16,
      providerOutput: 42,
    });
    expect(u).toEqual({
      input: 5,
      output: 42,
      total: 47,
      estimatedInput: true,
    });
  });

  it('mixes provider value with fallback when only output is missing', () => {
    const u = computeTokenUsage({
      promptChars: 8,
      outputChars: 100,
      providerInput: 77,
    });
    expect(u).toEqual({
      input: 77,
      output: 25,
      total: 102,
      estimatedOutput: true,
    });
  });

  it('supports zero-char outputs (error / cancel before any tokens)', () => {
    const u = computeTokenUsage({ promptChars: 12, outputChars: 0 });
    expect(u.output).toBe(0);
    expect(u.total).toBe(u.input + 0);
    expect(u.estimatedInput).toBe(true);
    expect(u.estimatedOutput).toBe(true);
  });
});
