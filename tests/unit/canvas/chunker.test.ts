import { describe, expect, it } from 'vitest';
import { chunkCanvasBody } from '@/agent/canvas/chunker';

describe('chunkCanvasBody — empty / whitespace', () => {
  it('empty body → []', () => {
    const out = chunkCanvasBody({ body: '', targetTokens: 100, overlapTokens: 10, maxChunks: 5 });
    expect(out).toEqual([]);
  });

  it('whitespace-only body → []', () => {
    const out = chunkCanvasBody({
      body: '   \n\n   ',
      targetTokens: 100,
      overlapTokens: 10,
      maxChunks: 5,
    });
    expect(out).toEqual([]);
  });

  it('maxChunks < 1 → []', () => {
    const out = chunkCanvasBody({
      body: '# heading\n\ntext',
      targetTokens: 100,
      overlapTokens: 10,
      maxChunks: 0,
    });
    expect(out).toEqual([]);
  });
});

describe('chunkCanvasBody — under target', () => {
  it('body under target tokens → single chunk, headingPath empty', () => {
    const body = '# A\nlittle content';
    const out = chunkCanvasBody({ body, targetTokens: 200, overlapTokens: 10, maxChunks: 5 });
    expect(out).toHaveLength(1);
    expect(out[0]?.index).toBe(0);
    expect(out[0]?.text).toBe(body);
    expect(out[0]?.headingPath).toEqual([]);
  });
});

describe('chunkCanvasBody — markdown stacked headings', () => {
  it('emits one chunk per heading section with stacked heading path', () => {
    const body = '# A\ncontent for A\n## A.1\ncontent for A.1\n# B\ncontent for B\n';
    const out = chunkCanvasBody({ body, targetTokens: 10, overlapTokens: 2, maxChunks: 10 });
    expect(out.length).toBe(3);
    expect(out[0]?.headingPath).toEqual(['A']);
    expect(out[0]?.text.startsWith('# A')).toBe(true);
    expect(out[1]?.headingPath).toEqual(['A', 'A.1']);
    expect(out[1]?.text.startsWith('## A.1')).toBe(true);
    expect(out[2]?.headingPath).toEqual(['B']);
    expect(out[2]?.text.startsWith('# B')).toBe(true);
    expect(out.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  it('preamble before first heading retains empty headingPath', () => {
    const body = 'preamble line\n# A\ncontent for A please\n';
    const out = chunkCanvasBody({ body, targetTokens: 8, overlapTokens: 1, maxChunks: 10 });
    expect(out[0]?.headingPath).toEqual([]);
    expect(out[0]?.text).toContain('preamble');
    expect(out.some((c) => c.headingPath[0] === 'A')).toBe(true);
  });
});

describe('chunkCanvasBody — oversized section sub-splits', () => {
  it('section exceeding targetTokens splits with overlap, all chunks share heading path', () => {
    const heavy = Array.from({ length: 30 }, (_, i) => `line ${i.toString()}`).join('\n');
    const body = `# A\n${heavy}\n# B\nshort B`;
    const out = chunkCanvasBody({ body, targetTokens: 8, overlapTokens: 2, maxChunks: 50 });
    const aChunks = out.filter((c) => c.headingPath[0] === 'A');
    expect(aChunks.length).toBeGreaterThan(1);
    const bChunks = out.filter((c) => c.headingPath[0] === 'B');
    expect(bChunks.length).toBe(1);
    expect(out.every((c) => c.text.length > 0)).toBe(true);
  });
});

describe('chunkCanvasBody — non-markdown', () => {
  it('text/plain → fixed-window, headingPath always empty', () => {
    const body = Array.from({ length: 40 }, (_, i) => `line${i.toString()}`).join('\n');
    const out = chunkCanvasBody({
      body,
      contentType: 'text/plain',
      targetTokens: 10,
      overlapTokens: 2,
      maxChunks: 50,
    });
    expect(out.length).toBeGreaterThan(1);
    expect(out.every((c) => c.headingPath.length === 0)).toBe(true);
  });

  it('text/markdown contentType is detected with parameters', () => {
    const body = '# A\ncontent\n# B\nmore content here';
    const out = chunkCanvasBody({
      body,
      contentType: 'text/markdown; charset=utf-8',
      targetTokens: 5,
      overlapTokens: 1,
      maxChunks: 10,
    });
    expect(out.some((c) => c.headingPath[0] === 'A')).toBe(true);
    expect(out.some((c) => c.headingPath[0] === 'B')).toBe(true);
  });
});

describe('chunkCanvasBody — oversized single line', () => {
  it('does not infinite-loop; emits a single oversized chunk', () => {
    const body = 'a'.repeat(800);
    const out = chunkCanvasBody({
      body,
      contentType: 'text/plain',
      targetTokens: 10,
      overlapTokens: 2,
      maxChunks: 5,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.text.length).toBe(800);
  });
});

describe('chunkCanvasBody — maxChunks cap', () => {
  it('truncates output to maxChunks even when more sections exist', () => {
    const body = ['# A', 'a', '# B', 'b', '# C', 'c', '# D', 'd', '# E', 'e'].join('\n');
    const out = chunkCanvasBody({ body, targetTokens: 5, overlapTokens: 1, maxChunks: 2 });
    expect(out).toHaveLength(2);
    expect(out[0]?.headingPath[0]).toBe('A');
    expect(out[1]?.headingPath[0]).toBe('B');
  });
});
