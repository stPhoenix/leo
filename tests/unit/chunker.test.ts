import { describe, expect, it } from 'vitest';
import {
  CHUNK_OVERLAP_TOKENS,
  CHUNK_TARGET_TOKENS,
  chunk,
  type CachedMetadataLike,
  type ChunkerInput,
  type HeadingCacheLike,
  type TagCacheLike,
} from '@/indexer/chunker';
import { estimateTokens } from '@/agent/tokenCount';

function heading(text: string, level: number, line: number): HeadingCacheLike {
  return { heading: text, level, position: { start: { line }, end: { line } } };
}

function tag(name: string, line: number): TagCacheLike {
  return { tag: name, position: { start: { line }, end: { line } } };
}

function input(source: string, fileCache: CachedMetadataLike, path = 'note.md'): ChunkerInput {
  return { path, source, fileCache };
}

describe('Chunker — pure heading segmentation', () => {
  it('emits one chunk per heading section with H1 > H2 > H3 ancestry', () => {
    const source = [
      '# Root',
      'root body',
      '## A',
      'a body',
      '### A.1',
      'a.1 body',
      '## B',
      'b body',
    ].join('\n');
    const headings = [
      heading('Root', 1, 0),
      heading('A', 2, 2),
      heading('A.1', 3, 4),
      heading('B', 2, 6),
    ];
    const out = chunk(input(source, { headings }));
    expect(out.length).toBe(4);
    expect(out[0]?.heading_path).toEqual(['Root']);
    expect(out[1]?.heading_path).toEqual(['Root', 'A']);
    expect(out[2]?.heading_path).toEqual(['Root', 'A', 'A.1']);
    expect(out[3]?.heading_path).toEqual(['Root', 'B']);
  });

  it('line_start / line_end cover heading line through line before next same-or-shallower heading', () => {
    const source = ['# Alpha', 'alpha body', '## Beta', 'beta body', '# Gamma', 'gamma body'].join(
      '\n',
    );
    const headings = [heading('Alpha', 1, 0), heading('Beta', 2, 2), heading('Gamma', 1, 4)];
    const out = chunk(input(source, { headings }));
    expect(out[0]?.line_start).toBe(0);
    expect(out[0]?.line_end).toBe(3);
    expect(out[1]?.line_start).toBe(2);
    expect(out[1]?.line_end).toBe(3);
    expect(out[2]?.line_start).toBe(4);
    expect(out[2]?.line_end).toBe(5);
  });

  it('zero-heading file emits single chunk spanning the whole body with empty heading_path', () => {
    const source = 'just a body\nwith two lines';
    const out = chunk(input(source, {}));
    expect(out.length).toBe(1);
    expect(out[0]?.heading_path).toEqual([]);
    expect(out[0]?.line_start).toBe(0);
    expect(out[0]?.line_end).toBe(1);
    expect(out[0]?.text).toBe(source);
  });

  it('empty source returns []', () => {
    expect(chunk(input('', {}))).toEqual([]);
  });
});

describe('Chunker — fixed-size fallback', () => {
  it('oversized section falls back to sliding windows with ~64-token overlap', () => {
    // Build a section large enough to trigger the fallback.
    const lines: string[] = ['# Big'];
    for (let i = 0; i < 400; i += 1) lines.push(`line body content filler ${i}`); // ~28 chars → ~7 tokens each
    const source = lines.join('\n');
    const headings = [heading('Big', 1, 0)];
    const out = chunk(input(source, { headings }));
    expect(out.length).toBeGreaterThan(1);
    // All chunks share the heading path
    for (const c of out) {
      expect(c.heading_path).toEqual(['Big']);
      expect(estimateTokens(c.text)).toBeLessThanOrEqual(CHUNK_TARGET_TOKENS + 20);
    }
    // Adjacent windows overlap on whole-line boundaries
    for (let i = 0; i + 1 < out.length; i += 1) {
      const curEnd = out[i]!.line_end;
      const nextStart = out[i + 1]!.line_start;
      expect(nextStart).toBeLessThanOrEqual(curEnd);
    }
  });

  it('all window boundaries are integers and snap to whole lines', () => {
    const lines: string[] = [];
    for (let i = 0; i < 300; i += 1) lines.push(`chunk-line ${i}`);
    const source = lines.join('\n');
    const out = chunk(input(source, {}));
    for (const c of out) {
      expect(Number.isInteger(c.line_start)).toBe(true);
      expect(Number.isInteger(c.line_end)).toBe(true);
    }
  });

  it('enforces the CHUNK_OVERLAP_TOKENS = 64 constant', () => {
    expect(CHUNK_OVERLAP_TOKENS).toBe(64);
    expect(CHUNK_TARGET_TOKENS).toBe(512);
  });
});

describe('Chunker — frontmatter tag normalization', () => {
  it('accepts tags: as a single string', () => {
    const source = 'body';
    const out = chunk(input(source, { frontmatter: { tags: 'solo' } }));
    expect(out[0]?.frontmatter_tags).toEqual(['solo']);
  });

  it('accepts tags: as an array and strips leading #', () => {
    const source = 'body';
    const out = chunk(input(source, { frontmatter: { tags: ['#alpha', 'beta', '#alpha'] } }));
    expect(out[0]?.frontmatter_tags).toEqual(['alpha', 'beta']);
  });

  it('falls back to tag: when tags: is missing', () => {
    const source = 'body';
    const out = chunk(input(source, { frontmatter: { tag: 'legacy' } }));
    expect(out[0]?.frontmatter_tags).toEqual(['legacy']);
  });

  it('returns empty frontmatter_tags when frontmatter is missing', () => {
    const source = 'body';
    const out = chunk(input(source, {}));
    expect(out[0]?.frontmatter_tags).toEqual([]);
  });

  it('trims whitespace and drops empties', () => {
    const source = 'body';
    const out = chunk(input(source, { frontmatter: { tags: ['  spaced  ', '', '  #hashed'] } }));
    expect(out[0]?.frontmatter_tags).toEqual(['spaced', 'hashed']);
  });

  it('all chunks of the same file share the same frontmatter_tags snapshot', () => {
    const source = ['# One', 'body1', '# Two', 'body2'].join('\n');
    const headings = [heading('One', 1, 0), heading('Two', 1, 2)];
    const out = chunk(input(source, { headings, frontmatter: { tags: ['shared'] } }));
    expect(out.length).toBe(2);
    expect(out[0]?.frontmatter_tags).toEqual(['shared']);
    expect(out[1]?.frontmatter_tags).toEqual(['shared']);
  });
});

describe('Chunker — inline tag scoping', () => {
  it('keeps only tags whose position falls inside the chunk line range', () => {
    const source = ['# A', 'tag-a body', '# B', 'tag-b body'].join('\n');
    const headings = [heading('A', 1, 0), heading('B', 1, 2)];
    const tags = [tag('in-a', 1), tag('in-b', 3)];
    const out = chunk(input(source, { headings, tags }));
    expect(out[0]?.inline_tags).toEqual(['in-a']);
    expect(out[1]?.inline_tags).toEqual(['in-b']);
  });

  it('excludes frontmatter-line tags from inline_tags', () => {
    const source = ['---', 'tags: [a, b]', '---', '# Body', 'content'].join('\n');
    const headings = [heading('Body', 1, 3)];
    const tags = [tag('a', 1), tag('b', 1)]; // on line 1 inside frontmatter
    const fileCache: CachedMetadataLike = {
      headings,
      tags,
      frontmatter: { tags: ['a', 'b'] },
      frontmatterPosition: { start: { line: 0 }, end: { line: 2 } },
    };
    const out = chunk(input(source, fileCache));
    expect(out[0]?.inline_tags).toEqual([]);
    expect(out[0]?.frontmatter_tags).toEqual(['a', 'b']);
  });

  it('strips leading # and dedupes in first-seen order', () => {
    const source = 'line 0\nline 1';
    const tags = [tag('#alpha', 0), tag('alpha', 0), tag('#beta', 1)];
    const out = chunk(input(source, { tags }));
    expect(out[0]?.inline_tags).toEqual(['alpha', 'beta']);
  });
});

describe('Chunker — determinism + canonical shape', () => {
  it('returns byte-identical chunks on repeated calls', () => {
    const source = ['# A', 'a body', '## A.1', 'a1 body', '# B', 'b body'].join('\n');
    const headings = [heading('A', 1, 0), heading('A.1', 2, 2), heading('B', 1, 4)];
    const fileCache: CachedMetadataLike = {
      headings,
      frontmatter: { tags: ['x'] },
      tags: [tag('in', 1)],
    };
    const first = chunk(input(source, fileCache));
    const second = chunk(input(source, fileCache));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('every chunk has canonical shape with integer line numbers and exact text', () => {
    const source = 'hello\nworld\nthird';
    const out = chunk(input(source, {}));
    const c = out[0]!;
    expect(typeof c.path).toBe('string');
    expect(Number.isInteger(c.line_start)).toBe(true);
    expect(Number.isInteger(c.line_end)).toBe(true);
    expect(Array.isArray(c.heading_path)).toBe(true);
    expect(Array.isArray(c.frontmatter_tags)).toBe(true);
    expect(Array.isArray(c.inline_tags)).toBe(true);
    expect(typeof c.text).toBe('string');
    expect(c.text).toBe(source);
  });
});
