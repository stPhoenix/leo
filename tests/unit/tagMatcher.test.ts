import { describe, expect, it } from 'vitest';
import { compileTagPredicate, matches, normalizeTag, normalizeTags } from '@/rag/tagMatcher';

describe('TagMatcher', () => {
  describe('normalizeTag', () => {
    it('lowercases, strips leading #, trims whitespace', () => {
      expect(normalizeTag('#Foo')).toBe('foo');
      expect(normalizeTag('  #BAR  ')).toBe('bar');
      expect(normalizeTag('##nested')).toBe('nested');
      expect(normalizeTag('area/work')).toBe('area/work');
      expect(normalizeTag('')).toBe('');
    });
  });

  describe('normalizeTags', () => {
    it('dedupes and drops empties', () => {
      expect(normalizeTags(['#Foo', 'foo', 'BAR', '  ', '#bar', ''])).toEqual(['foo', 'bar']);
    });

    it('returns empty for all-empty input', () => {
      expect(normalizeTags([])).toEqual([]);
      expect(normalizeTags(['  ', '#'])).toEqual([]);
    });
  });

  describe('matches', () => {
    it('empty requested returns true (no filter)', () => {
      expect(matches({ frontmatter: [], inline: [] }, [])).toBe(true);
      expect(matches({ frontmatter: ['foo'], inline: [] }, [])).toBe(true);
    });

    it('single match against frontmatter tag', () => {
      expect(matches({ frontmatter: ['foo'], inline: [] }, ['foo'])).toBe(true);
    });

    it('single match against inline tag', () => {
      expect(matches({ frontmatter: [], inline: ['foo'] }, ['foo'])).toBe(true);
    });

    it('multi-match — any intersection returns true', () => {
      expect(matches({ frontmatter: ['a', 'b'], inline: ['c'] }, ['x', 'c', 'z'])).toBe(true);
    });

    it('zero intersection returns false', () => {
      expect(matches({ frontmatter: ['a'], inline: ['b'] }, ['x', 'y'])).toBe(false);
    });

    it('case-insensitive match', () => {
      expect(matches({ frontmatter: ['Foo'], inline: [] }, ['FOO'])).toBe(true);
    });

    it('# stripped on both sides', () => {
      expect(matches({ frontmatter: ['#tag'], inline: [] }, ['tag'])).toBe(true);
      expect(matches({ frontmatter: ['tag'], inline: [] }, ['#tag'])).toBe(true);
      expect(matches({ frontmatter: ['#Tag'], inline: [] }, ['#tag'])).toBe(true);
    });

    it('frontmatter-only source matches', () => {
      expect(matches({ frontmatter: ['only-fm'], inline: [] }, ['only-fm'])).toBe(true);
    });

    it('inline-only source matches', () => {
      expect(matches({ frontmatter: [], inline: ['only-inline'] }, ['only-inline'])).toBe(true);
    });

    it('both sources present — union semantics', () => {
      expect(matches({ frontmatter: ['a'], inline: ['b'] }, ['b'])).toBe(true);
    });

    it('does not throw on malformed tag arrays', () => {
      expect(
        matches(
          { frontmatter: [null as unknown as string], inline: [undefined as unknown as string] },
          ['foo'],
        ),
      ).toBe(false);
    });
  });

  describe('compileTagPredicate', () => {
    it('empty requested compiles to always-true predicate', () => {
      const p = compileTagPredicate([]);
      expect(p({ frontmatter: [], inline: [] })).toBe(true);
      expect(p({ frontmatter: ['any'], inline: ['x'] })).toBe(true);
    });

    it('compiled predicate is equivalent to matches()', () => {
      const p = compileTagPredicate(['foo', '#bar']);
      expect(p({ frontmatter: ['FOO'], inline: [] })).toBe(true);
      expect(p({ frontmatter: [], inline: ['Bar'] })).toBe(true);
      expect(p({ frontmatter: ['x'], inline: ['y'] })).toBe(false);
    });
  });
});
