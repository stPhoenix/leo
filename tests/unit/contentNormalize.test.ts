import { describe, it, expect } from 'vitest';
import { normalizeForOpenAI } from '@/providers/contentNormalize';
import type { ChatMessage } from '@/providers/types';

const b64 = (s: string): string => Buffer.from(s, 'utf-8').toString('base64');

describe('normalizeForOpenAI — document blocks', () => {
  it('inlines text/markdown documents into a text block', () => {
    const msgs: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'read this' },
          {
            type: 'document',
            source: { type: 'base64', media_type: 'text/markdown', data: b64('# Hello\nWorld') },
          },
        ],
      },
    ];
    const out = normalizeForOpenAI(msgs, { supportsVision: false });
    expect(out).toHaveLength(1);
    const content = out[0]!.content;
    expect(typeof content).toBe('string');
    expect(content as string).toContain('read this');
    expect(content as string).toContain('# Hello\nWorld');
  });

  it('inlines application/json documents', () => {
    const msgs: ChatMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/json', data: b64('{"a":1}') },
          },
        ],
      },
    ];
    const out = normalizeForOpenAI(msgs, { supportsVision: false });
    expect(out[0]!.content as string).toContain('{"a":1}');
  });

  it('replaces binary documents with placeholder', () => {
    const msgs: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'see attached' },
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: 'AAAA' },
          },
        ],
      },
    ];
    const out = normalizeForOpenAI(msgs, { supportsVision: false });
    const content = out[0]!.content as string;
    expect(content).toContain('see attached');
    expect(content).toContain('application/pdf');
    expect(content).toContain('content omitted');
  });
});

describe('normalizeForOpenAI — image blocks', () => {
  it('preserves image blocks when vision is supported', () => {
    const msgs: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
        ],
      },
    ];
    const out = normalizeForOpenAI(msgs, { supportsVision: true });
    const content = out[0]!.content;
    expect(Array.isArray(content)).toBe(true);
    expect((content as readonly { type: string }[])[1]!.type).toBe('image');
  });

  it('replaces image blocks with placeholder when vision is unsupported', () => {
    const msgs: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
        ],
      },
    ];
    const out = normalizeForOpenAI(msgs, { supportsVision: false });
    const content = out[0]!.content;
    expect(typeof content).toBe('string');
    expect(content as string).toContain('does not support vision');
  });
});

describe('normalizeForOpenAI — passthrough', () => {
  it('leaves string content unchanged', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'hello' }];
    const out = normalizeForOpenAI(msgs, { supportsVision: true });
    expect(out[0]!.content).toBe('hello');
  });

  it('leaves text-only block array unchanged in shape (collapsed to string)', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];
    const out = normalizeForOpenAI(msgs, { supportsVision: true });
    expect(out[0]!.content).toBe('hi');
  });
});
