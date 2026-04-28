import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyMatch, scoreMatches } from '@/ui/chat/fuzzyMatch';

describe('fuzzyMatch', () => {
  it('returns empty matches when pattern is empty', () => {
    expect(fuzzyMatch('', 'clear')).toEqual([]);
  });

  it('returns null when pattern chars do not all appear in order', () => {
    expect(fuzzyMatch('xyz', 'clear')).toBeNull();
    expect(fuzzyMatch('rc', 'clear')).toBeNull();
  });

  it('returns match indices for a subsequence', () => {
    expect(fuzzyMatch('clr', 'clear')).toEqual([0, 1, 4]);
  });

  it('is case-insensitive', () => {
    expect(fuzzyMatch('CLR', 'clear')).toEqual([0, 1, 4]);
  });
});

describe('scoreMatches', () => {
  it('scores prefix matches higher than interior matches', () => {
    const a = scoreMatches('cle', 'clear', [0, 1, 2]);
    const b = scoreMatches('ler', 'cleaner', [1, 2, 6]);
    expect(a).toBeGreaterThan(b);
  });

  it('scores contiguous matches higher than gapped ones', () => {
    const contiguous = scoreMatches('clr', 'clr', [0, 1, 2]);
    const gapped = scoreMatches('clr', 'clear', [0, 1, 3]);
    expect(contiguous).toBeGreaterThan(gapped);
  });
});

describe('fuzzyFilter', () => {
  it('filters out items that do not match', () => {
    const items = ['clear', 'plan', 'context'];
    const out = fuzzyFilter('pl', items, (s) => s);
    expect(out.map((r) => r.item)).toEqual(['plan']);
  });

  it('ranks prefix matches first', () => {
    const items = ['clear', 'context', 'incorporate'];
    const out = fuzzyFilter('co', items, (s) => s);
    expect(out[0]?.item).toBe('context');
  });

  it('returns an empty list when nothing matches', () => {
    expect(fuzzyFilter('zzz', ['clear', 'plan'], (s) => s)).toEqual([]);
  });
});
