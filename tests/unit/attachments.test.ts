import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_COUNT_PER_TURN,
  buildUserContent,
  captureAttachments,
  detectVaultDrop,
  estimateAttachmentTokens,
  isVisionGateBlocked,
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
  it('produces text block first, then image and document blocks in capture order', () => {
    const atts: Attachment[] = [
      {
        id: 'a1',
        kind: 'image',
        name: 'p.png',
        mimeType: 'image/png',
        bytes: new Uint8Array([1, 2, 3]),
        size: 3,
      },
      {
        id: 'a2',
        kind: 'document',
        name: 'r.pdf',
        mimeType: 'application/pdf',
        bytes: new Uint8Array([4, 5, 6]),
        size: 3,
      },
    ];
    const blocks = buildUserContent('hello', atts, toBase64);
    expect(blocks).toEqual([
      { type: 'text', text: 'hello' },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: toBase64(new Uint8Array([1, 2, 3])),
        },
      },
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: toBase64(new Uint8Array([4, 5, 6])),
        },
      },
    ]);
  });
  it('produces single text block when no attachments', () => {
    expect(buildUserContent('hi', [], toBase64)).toEqual([{ type: 'text', text: 'hi' }]);
  });
});

describe('isVisionGateBlocked — AC5', () => {
  it('blocks when images present and vision unsupported', () => {
    const img: Attachment = {
      id: 'a',
      kind: 'image',
      name: 'p.png',
      mimeType: 'image/png',
      bytes: new Uint8Array(),
      size: 0,
    };
    expect(isVisionGateBlocked({ attachments: [img], modelSupportsVision: false })).toBe(true);
  });
  it('passes when vision supported', () => {
    const img: Attachment = {
      id: 'a',
      kind: 'image',
      name: 'p.png',
      mimeType: 'image/png',
      bytes: new Uint8Array(),
      size: 0,
    };
    expect(isVisionGateBlocked({ attachments: [img], modelSupportsVision: true })).toBe(false);
  });
  it('passes for document-only with no vision', () => {
    const doc: Attachment = {
      id: 'a',
      kind: 'document',
      name: 'r.pdf',
      mimeType: 'application/pdf',
      bytes: new Uint8Array(),
      size: 0,
    };
    expect(isVisionGateBlocked({ attachments: [doc], modelSupportsVision: false })).toBe(false);
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
    expect(estimateAttachmentTokens(blocks)).toBe(2 + 2000 + 2000);
  });
});
