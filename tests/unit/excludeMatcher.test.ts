import { describe, expect, it } from 'vitest';
import { compileMatcher, matches, normalizePatterns } from '@/rag/excludeMatcher';

describe('ExcludeMatcher', () => {
  it('empty patterns match nothing', () => {
    expect(matches('note.md', [])).toBe(false);
    expect(matches('drafts/x.md', [])).toBe(false);
  });

  it('exact pattern matches the exact path', () => {
    expect(matches('drafts.md', ['drafts.md'])).toBe(true);
    expect(matches('notes/drafts.md', ['drafts.md'])).toBe(false);
  });

  it('** matches recursively across directories', () => {
    expect(matches('drafts/a/b/c.md', ['drafts/**'])).toBe(true);
    expect(matches('notes/drafts/a.md', ['**/drafts/**'])).toBe(true);
    expect(matches('projects/x.md', ['drafts/**'])).toBe(false);
  });

  it('* matches a single path segment', () => {
    expect(matches('drafts/one.md', ['drafts/*.md'])).toBe(true);
    expect(matches('drafts/sub/one.md', ['drafts/*.md'])).toBe(false);
  });

  it('? matches a single character', () => {
    expect(matches('a.md', ['?.md'])).toBe(true);
    expect(matches('ab.md', ['?.md'])).toBe(false);
  });

  it('returns true when any pattern in the list matches', () => {
    expect(matches('scratch/x.md', ['drafts/**', 'scratch/**'])).toBe(true);
  });

  it('normalizePatterns trims, dedupes, drops empties and whitespace-only', () => {
    const result = normalizePatterns(['  drafts/**  ', 'drafts/**', '', '   ', 'scratch/**']);
    expect(result).toEqual(['drafts/**', 'scratch/**']);
  });

  it('compileMatcher returns a pure function closure over the patterns', () => {
    const fn = compileMatcher(['drafts/**']);
    expect(fn('drafts/x.md')).toBe(true);
    expect(fn('notes/x.md')).toBe(false);
  });

  it('compileMatcher on empty list is a constant-false predicate', () => {
    const fn = compileMatcher([]);
    expect(fn('any.md')).toBe(false);
  });
});
