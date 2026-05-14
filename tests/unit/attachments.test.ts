import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_COUNT_PER_TURN,
  buildUserContent,
  captureAttachments,
  detectVaultDrop,
  estimateAttachmentTokens,
  toBase64,
  type Attachment,
} from '@/chat/attachments';

function fakeFile(
  name: string,
  mimeType: string,
  size = 100,
  bytes: Uint8Array = new Uint8Array([1, 2, 3]),
): { name: string; mimeType: string; bytes: Uint8Array; size: number } {
  return { name, mimeType, bytes, size };
}

describe('constants', () => {
  it('pins 10 MB per-attachment + 4-per-turn caps', () => {
    expect(ATTACHMENT_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(ATTACHMENT_MAX_COUNT_PER_TURN).toBe(4);
  });
});

describe('captureAttachments — AC1/AC2/AC6', () => {
  it('lifts image paste as kind=image', () => {
    const res = captureAttachments([fakeFile('p.png', 'image/png')], { current: [] });
    expect(res.attachments).toHaveLength(1);
    expect(res.attachments[0]!.kind).toBe('image');
  });

  it('lifts PDF drop as kind=document', () => {
    const res = captureAttachments([fakeFile('r.pdf', 'application/pdf')], { current: [] });
    expect(res.attachments[0]!.kind).toBe('document');
  });

  it('mixed image + doc both accepted', () => {
    const res = captureAttachments(
      [fakeFile('p.png', 'image/png'), fakeFile('r.pdf', 'application/pdf')],
      { current: [] },
    );
    expect(res.attachments.map((a) => a.kind)).toEqual(['image', 'document']);
  });

  it('oversize per-attachment rejected with reason', () => {
    const res = captureAttachments([fakeFile('big.png', 'image/png', ATTACHMENT_MAX_BYTES + 1)], {
      current: [],
    });
    expect(res.attachments).toHaveLength(0);
    expect(res.rejected[0]!.reason.kind).toBe('oversize');
  });

  it('honours 4-per-turn cap', () => {
    const four: Attachment[] = Array.from({ length: 4 }, (_, i) => ({
      id: `a${i}`,
      kind: 'image',
      name: `p${i}.png`,
      mimeType: 'image/png',
      bytes: new Uint8Array(),
      size: 100,
    }));
    const res = captureAttachments([fakeFile('more.png', 'image/png')], { current: four });
    expect(res.attachments).toHaveLength(0);
    expect(res.rejected[0]!.reason.kind).toBe('limit_reached');
  });

  it('unsupported document mime rejected', () => {
    const res = captureAttachments([fakeFile('unk.exe', 'application/octet-stream')], {
      current: [],
    });
    expect(res.attachments).toHaveLength(0);
    expect(res.rejected[0]!.reason.kind).toBe('unsupported_mime');
  });

  it('accepts text/* document MIMEs from the allowlist prefix', () => {
    const res = captureAttachments([fakeFile('note.txt', 'text/plain')], { current: [] });
    expect(res.attachments).toHaveLength(1);
    expect(res.attachments[0]!.kind).toBe('document');
  });
});

describe('detectVaultDrop — AC3', () => {
  it('recognises wrapped wikilink payload', () => {
    const r = detectVaultDrop({ textPlain: '[[notes/a.md]]' });
    expect(r).toEqual({ wikilink: '[[notes/a.md]]', path: 'notes/a.md' });
  });
  it('wraps raw vault-relative path with file extension', () => {
    const r = detectVaultDrop({ textPlain: 'notes/a.md' });
    expect(r).toEqual({ wikilink: '[[notes/a.md]]', path: 'notes/a.md' });
  });
  it('returns null on non-path text', () => {
    expect(detectVaultDrop({ textPlain: 'just some text' })).toBeNull();
    expect(detectVaultDrop({ textPlain: '' })).toBeNull();
    expect(detectVaultDrop({})).toBeNull();
  });
  it('respects optional fileExists guard', () => {
    const r = detectVaultDrop({
      textPlain: 'nope.md',
      fileExists: () => false,
    });
    expect(r).toBeNull();
  });
});

describe('buildUserContent — AC4', () => {
  it('prepends a text-note block before image and binary-document blocks; preserves base64 content', () => {
    const atts: Attachment[] = [
      {
        id: 'a1',
        kind: 'image',
        name: 'p.png',
        mimeType: 'image/png',
        bytes: new Uint8Array([1, 2, 3]),
        size: 3,
        path: '.leo/attachments/2026-05-12-abc-p.png',
      },
      {
        id: 'a2',
        kind: 'document',
        name: 'r.pdf',
        mimeType: 'application/pdf',
        bytes: new Uint8Array([4, 5, 6]),
        size: 3,
        path: '.leo/attachments/2026-05-12-def-r.pdf',
      },
    ];
    const blocks = buildUserContent('hello', atts, toBase64);
    expect(blocks).toHaveLength(7);
    expect(blocks[0]).toEqual({ type: 'text', text: 'hello' });
    expect(blocks[1]).toMatchObject({ type: 'text' });
    expect((blocks[1] as { text: string }).text).toContain(
      'path=".leo/attachments/2026-05-12-abc-p.png"',
    );
    expect((blocks[1] as { text: string }).text).toContain('image');
    expect(blocks[2]).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: toBase64(new Uint8Array([1, 2, 3])),
      },
      name: 'p.png',
      size: 3,
    });
    expect(blocks[3]).toEqual({
      type: 'attachment_chip',
      kind: 'image',
      name: 'p.png',
      mimeType: 'image/png',
      size: 3,
      path: '.leo/attachments/2026-05-12-abc-p.png',
    });
    expect(blocks[4]).toMatchObject({ type: 'text' });
    expect((blocks[4] as { text: string }).text).toContain('r.pdf');
    expect((blocks[4] as { text: string }).text).toContain('binary');
    expect(blocks[5]).toEqual({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: toBase64(new Uint8Array([4, 5, 6])),
      },
      name: 'r.pdf',
      size: 3,
    });
    expect(blocks[6]).toEqual({
      type: 'attachment_chip',
      kind: 'document',
      name: 'r.pdf',
      mimeType: 'application/pdf',
      size: 3,
      path: '.leo/attachments/2026-05-12-def-r.pdf',
    });
  });

  it('emits an attachment_chip for text-decoded documents alongside inline text', () => {
    const atts: Attachment[] = [
      {
        id: 'a1',
        kind: 'document',
        name: 'note.md',
        mimeType: 'text/markdown',
        bytes: new TextEncoder().encode('# hello'),
        size: 7,
        path: '.leo/attachments/note.md',
      },
    ];
    const blocks = buildUserContent('hi', atts, toBase64);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({ type: 'text', text: 'hi' });
    expect(blocks[1]).toMatchObject({ type: 'text' });
    expect((blocks[1] as { text: string }).text).toContain('# hello');
    expect(blocks[2]).toEqual({
      type: 'attachment_chip',
      kind: 'document',
      name: 'note.md',
      mimeType: 'text/markdown',
      size: 7,
      path: '.leo/attachments/note.md',
    });
  });
  it('produces single text block when no attachments', () => {
    expect(buildUserContent('hi', [], toBase64)).toEqual([{ type: 'text', text: 'hi' }]);
  });
  it('omits path attribute in note when attachment has no path', () => {
    const blocks = buildUserContent(
      '',
      [
        {
          id: 'a1',
          kind: 'image',
          name: 'p.png',
          mimeType: 'image/png',
          bytes: new Uint8Array([1, 2, 3]),
          size: 3,
        },
      ],
      toBase64,
    );
    expect((blocks[1] as { text: string }).text).not.toContain('path=');
  });
});

describe('estimateAttachmentTokens — AC9', () => {
  it('credits 2000 tokens per image + per document and len/4 for text', () => {
    const blocks = buildUserContent(
      'a'.repeat(8),
      [
        {
          id: '1',
          kind: 'image',
          name: 'p.png',
          mimeType: 'image/png',
          bytes: new Uint8Array(),
          size: 0,
        },
        {
          id: '2',
          kind: 'document',
          name: 'r.pdf',
          mimeType: 'application/pdf',
          bytes: new Uint8Array(),
          size: 0,
        },
      ],
      toBase64,
    );
    let textTokens = 0;
    let images = 0;
    let docs = 0;
    for (const b of blocks) {
      if (b.type === 'text') textTokens += Math.round(b.text.length / 4);
      else if (b.type === 'image') images += 1;
      else if (b.type === 'document') docs += 1;
    }
    expect(images).toBe(1);
    expect(docs).toBe(1);
    expect(estimateAttachmentTokens(blocks)).toBe(textTokens + 2000 + 2000);
  });
});
