import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_TRUNCATE_CHARS,
  ATTACHMENT_TRUNCATE_TOKENS,
  buildUserContent,
  toBase64,
  type Attachment,
} from '@/chat/attachments';

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function textAttachment(text: string, mime: string, path?: string): Attachment {
  const bytes = encode(text);
  return {
    id: 'a1',
    kind: 'document',
    name: 'doc.txt',
    mimeType: mime,
    bytes,
    size: bytes.byteLength,
    ...(path !== undefined ? { path } : {}),
  };
}

describe('buildUserContent — text-document truncation', () => {
  it('emits single text block with full content when under cap', () => {
    const att = textAttachment('hello world', 'text/plain', '.leo/attachments/x.txt');
    const blocks = buildUserContent('', [att], toBase64);
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toMatchObject({ type: 'text' });
    const text = (blocks[1] as { text: string }).text;
    expect(text).toContain('hello world');
    expect(text).toContain('path=".leo/attachments/x.txt"');
    expect(text).not.toContain('truncated');
  });

  it('truncates over-cap text to ATTACHMENT_TRUNCATE_CHARS and includes read_file hint with path', () => {
    const big = 'a'.repeat(ATTACHMENT_TRUNCATE_CHARS * 3);
    const att = textAttachment(big, 'text/markdown', '.leo/attachments/big.md');
    const blocks = buildUserContent('', [att], toBase64);
    const text = (blocks[1] as { text: string }).text;
    expect(text).toContain(`truncated ${ATTACHMENT_TRUNCATE_TOKENS}/`);
    expect(text).toContain('use read_file path=".leo/attachments/big.md"');
    expect(text.length).toBeLessThan(ATTACHMENT_TRUNCATE_CHARS + 500);
  });

  it('truncates application/json the same way as text/*', () => {
    const big = JSON.stringify({ k: 'v'.repeat(ATTACHMENT_TRUNCATE_CHARS) });
    const att = textAttachment(big, 'application/json', '.leo/attachments/big.json');
    const blocks = buildUserContent('', [att], toBase64);
    const text = (blocks[1] as { text: string }).text;
    expect(text).toContain('truncated');
    expect(text).toContain('application/json');
  });

  it('no-path text doc still truncates but omits the read_file hint', () => {
    const big = 'b'.repeat(ATTACHMENT_TRUNCATE_CHARS * 2);
    const att = textAttachment(big, 'text/plain');
    const blocks = buildUserContent('', [att], toBase64);
    const text = (blocks[1] as { text: string }).text;
    expect(text).toContain('truncated');
    expect(text).not.toContain('read_file');
    expect(text).toContain('no path');
  });

  it('does not produce a DocumentBlock for text-decodable mime (replaces with TextBlock)', () => {
    const att = textAttachment('plain text', 'text/plain', 'p.txt');
    const blocks = buildUserContent('', [att], toBase64);
    expect(blocks.some((b) => b.type === 'document')).toBe(false);
  });

  it('binary PDF keeps DocumentBlock and prepends a note', () => {
    const att: Attachment = {
      id: 'a1',
      kind: 'document',
      name: 'r.pdf',
      mimeType: 'application/pdf',
      bytes: new Uint8Array([0, 1, 2, 3, 4, 5]),
      size: 6,
      path: '.leo/attachments/r.pdf',
    };
    const blocks = buildUserContent('', [att], toBase64);
    expect(blocks).toHaveLength(3);
    expect(blocks[1]).toMatchObject({ type: 'text' });
    expect((blocks[1] as { text: string }).text).toContain('binary');
    expect(blocks[2]).toMatchObject({ type: 'document' });
  });

  it('image keeps ImageBlock and prepends a note with path', () => {
    const att: Attachment = {
      id: 'a1',
      kind: 'image',
      name: 'pic.png',
      mimeType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
      size: 3,
      path: '.leo/attachments/pic.png',
    };
    const blocks = buildUserContent('', [att], toBase64);
    expect(blocks).toHaveLength(3);
    expect(blocks[1]).toMatchObject({ type: 'text' });
    expect((blocks[1] as { text: string }).text).toContain('path=".leo/attachments/pic.png"');
    expect(blocks[2]).toMatchObject({ type: 'image' });
  });

  it('preserves UTF-8 multibyte content in truncated text', () => {
    const text = 'café ☕ '.repeat(50);
    const att = textAttachment(text, 'text/plain', 'c.txt');
    const blocks = buildUserContent('', [att], toBase64);
    const out = (blocks[1] as { text: string }).text;
    expect(out).toContain('café');
  });
});
