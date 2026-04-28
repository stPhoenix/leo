import { describe, it, expect } from 'vitest';
import { HumanMessage } from '@langchain/core/messages';
import { toLangchainMessages } from '@/providers/langchainMessages';
import type { ChatMessage } from '@/providers/types';

describe('toLangchainMessages — multimodal user blocks', () => {
  it('converts text-only string content unchanged', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'hello' }];
    const lc = toLangchainMessages(msgs);
    expect(lc).toHaveLength(1);
    expect(lc[0]).toBeInstanceOf(HumanMessage);
    expect((lc[0] as HumanMessage).content).toBe('hello');
  });

  it('maps image block to standardized v1 content block', () => {
    const msgs: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
        ],
      },
    ];
    const lc = toLangchainMessages(msgs);
    const content = (lc[0] as HumanMessage).content as Array<Record<string, unknown>>;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0]).toEqual({ type: 'text', text: 'look' });
    expect(content[1]).toEqual({
      type: 'image',
      source_type: 'base64',
      data: 'AAAA',
      mime_type: 'image/png',
    });
  });

  it('maps document block to standardized v1 file content block', () => {
    const msgs: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'read this' },
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: 'BBBB' },
          },
        ],
      },
    ];
    const lc = toLangchainMessages(msgs);
    const content = (lc[0] as HumanMessage).content as Array<Record<string, unknown>>;
    expect(content[1]).toEqual({
      type: 'file',
      source_type: 'base64',
      data: 'BBBB',
      mime_type: 'application/pdf',
    });
  });

  it('flattens text content for system / assistant / tool roles', () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'assistant', content: 'asst' },
      { role: 'tool', content: 'res', toolCallId: 't1', name: 'readNote' },
    ];
    const lc = toLangchainMessages(msgs);
    expect(lc).toHaveLength(3);
    expect((lc[0] as { content: unknown }).content).toBe('sys');
    expect((lc[1] as { content: unknown }).content).toBe('asst');
    expect((lc[2] as { content: unknown }).content).toBe('res');
  });
});
