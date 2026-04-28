// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { SentAttachmentList } from '@/ui/chat/SentAttachmentList';
import type { ContentBlock } from '@/chat/types';

afterEach(() => cleanup());

describe('SentAttachmentList', () => {
  it('returns null when no image/document blocks present', () => {
    const blocks: readonly ContentBlock[] = [{ type: 'text', text: 'hello' }];
    const { container } = render(<SentAttachmentList blocks={blocks} />);
    expect(container.querySelector('[data-slot="sent-attachments"]')).toBeNull();
  });

  it('renders an image chip with thumbnail data URL', () => {
    const blocks: readonly ContentBlock[] = [
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
        name: 'shot.png',
        size: 1234,
      },
    ];
    const { container } = render(<SentAttachmentList blocks={blocks} />);
    const thumb = container.querySelector('img[data-slot="sent-thumb"]') as HTMLImageElement;
    expect(thumb).not.toBeNull();
    expect(thumb.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(container.textContent).toContain('shot.png');
  });

  it('renders a document chip without thumbnail', () => {
    const blocks: readonly ContentBlock[] = [
      {
        type: 'document',
        source: { type: 'base64', media_type: 'text/markdown', data: 'AAAA' },
        name: 'notes.md',
        size: 200,
      },
    ];
    const { container } = render(<SentAttachmentList blocks={blocks} />);
    expect(container.querySelector('img[data-slot="sent-thumb"]')).toBeNull();
    expect(container.textContent).toContain('notes.md');
  });

  it('falls back to generic name when block has none', () => {
    const blocks: readonly ContentBlock[] = [
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: 'AAAA' },
      },
    ];
    const { container } = render(<SentAttachmentList blocks={blocks} />);
    expect(container.textContent).toContain('document');
  });
});
