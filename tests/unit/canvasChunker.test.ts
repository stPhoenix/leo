import { describe, expect, it, vi } from 'vitest';
import { chunk, type CanvasChunk } from '@/indexer/CanvasChunker';

function mkLogger(): {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
} {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe('CanvasChunker', () => {
  it('parses text + file + link + label-group nodes in document order', () => {
    const source = JSON.stringify({
      nodes: [
        { id: '1', type: 'text', text: 'Hello #foo world' },
        { id: '2', type: 'file', file: 'Notes/Daily.md' },
        { id: '3', type: 'link', url: 'https://example.com' },
        { id: '4', type: 'group', label: 'My Area' },
      ],
    });
    const chunks = chunk({ path: 'board.canvas', source });
    expect(chunks.length).toBe(4);
    expect(chunks.map((c) => c.node_id)).toEqual(['1', '2', '3', '4']);
    expect(chunks[0]?.text).toBe('Hello #foo world');
    expect(chunks[0]?.inline_tags).toEqual(['foo']);
    expect(chunks[1]?.text).toBe('file: Notes/Daily.md');
    expect(chunks[2]?.text).toBe('link: https://example.com');
    expect(chunks[3]?.text).toBe('label: My Area');
    for (const c of chunks) {
      expect(c.heading_path).toEqual(['canvas']);
      expect(c.frontmatter_tags).toEqual([]);
      expect(c.line_start).toBe(0);
      expect(c.line_end).toBe(0);
      expect(c.path).toBe('board.canvas');
    }
  });

  it('skips nodes with unknown type and no label', () => {
    const source = JSON.stringify({
      nodes: [
        { id: '1', type: 'ufo' },
        { id: '2', type: 'text', text: 'kept' },
      ],
    });
    const chunks = chunk({ path: 'x.canvas', source });
    expect(chunks.length).toBe(1);
    expect(chunks[0]?.node_id).toBe('2');
  });

  it('skips empty-body nodes — no empty-text chunk ever emitted', () => {
    const source = JSON.stringify({
      nodes: [
        { id: 'a', type: 'text', text: '   ' },
        { id: 'b', type: 'file', file: '' },
        { id: 'c', type: 'link', url: '' },
        { id: 'd', type: 'group', label: '' },
      ],
    });
    const chunks = chunk({ path: 'x.canvas', source });
    expect(chunks).toEqual([]);
  });

  it('extracts inline tags with F28-style normalisation (trim, #-strip, dedupe first-seen)', () => {
    const source = JSON.stringify({
      nodes: [
        {
          id: '1',
          type: 'text',
          text: 'Mix of #alpha and #beta and #alpha again, plus nested #area/work tag.',
        },
      ],
    });
    const chunks = chunk({ path: 'x.canvas', source });
    expect(chunks[0]?.inline_tags).toEqual(['alpha', 'beta', 'area/work']);
  });

  it('file/link/label nodes have empty inline_tags regardless of body content', () => {
    const source = JSON.stringify({
      nodes: [
        { id: '1', type: 'file', file: 'path/with/#hashes.md' },
        { id: '2', type: 'link', url: 'https://example.com/#anchor' },
        { id: '3', type: 'group', label: 'group #label-but-not-tag' },
      ],
    });
    const chunks = chunk({ path: 'x.canvas', source });
    for (const c of chunks) expect(c.inline_tags).toEqual([]);
  });

  it('malformed JSON returns [] + emits single indexer.canvas.parse-error warning', () => {
    const logger = mkLogger();
    const chunks = chunk({ path: 'x.canvas', source: '{broken' }, { logger: logger as never });
    expect(chunks).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('indexer.canvas.parse-error', expect.any(Object));
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('missing nodes key → [] + parse-error warning', () => {
    const logger = mkLogger();
    const chunks = chunk(
      { path: 'x.canvas', source: JSON.stringify({ edges: [] }) },
      { logger: logger as never },
    );
    expect(chunks).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('indexer.canvas.parse-error', expect.any(Object));
  });

  it('non-array nodes → [] + parse-error warning', () => {
    const logger = mkLogger();
    const chunks = chunk(
      { path: 'x.canvas', source: JSON.stringify({ nodes: 'not-array' }) },
      { logger: logger as never },
    );
    expect(chunks).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('indexer.canvas.parse-error', expect.any(Object));
  });

  it('empty nodes array → [] (not a parse error)', () => {
    const logger = mkLogger();
    const chunks = chunk(
      { path: 'x.canvas', source: JSON.stringify({ nodes: [] }) },
      { logger: logger as never },
    );
    expect(chunks).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('never throws into the indexer drain loop on malformed / weird inputs', () => {
    const weirdInputs = ['', 'null', 'undefined', '[]', '42', '"string"'];
    for (const src of weirdInputs) {
      expect(() => chunk({ path: 'x.canvas', source: src })).not.toThrow();
    }
  });

  it('deterministic snapshot: same input yields byte-identical Chunk[]', () => {
    const source = JSON.stringify({
      nodes: [
        { id: '1', type: 'text', text: 'Body one' },
        { id: '2', type: 'text', text: 'Body two' },
      ],
    });
    const a = chunk({ path: 'x.canvas', source });
    const b = chunk({ path: 'x.canvas', source });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('heading_path === ["canvas"] invariant on every emitted chunk', () => {
    const source = JSON.stringify({
      nodes: [
        { id: '1', type: 'text', text: 't' },
        { id: '2', type: 'file', file: 'f.md' },
        { id: '3', type: 'link', url: 'u' },
        { id: '4', type: 'group', label: 'g' },
      ],
    });
    const chunks: readonly CanvasChunk[] = chunk({ path: 'x.canvas', source });
    for (const c of chunks) expect(c.heading_path).toEqual(['canvas']);
  });

  it('indexer.canvas.skip-node debug event fires for missing-id and unknown-type', () => {
    const logger = mkLogger();
    const source = JSON.stringify({
      nodes: [
        { type: 'text', text: 'has body but no id' },
        { id: '1', type: 'unknown' },
      ],
    });
    const chunks = chunk({ path: 'x.canvas', source }, { logger: logger as never });
    expect(chunks).toEqual([]);
    expect(logger.debug).toHaveBeenCalledWith('indexer.canvas.skip-node', expect.any(Object));
  });
});
