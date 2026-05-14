// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { SentAttachmentList } from '@/ui/chat/SentAttachmentList';
import type { AttachmentChipBlock } from '@/chat/types';

afterEach(() => cleanup());

describe('SentAttachmentList', () => {
  it('returns null when no chips', () => {
    const { container } = render(<SentAttachmentList chips={[]} />);
    expect(container.querySelector('[data-slot="sent-attachments"]')).toBeNull();
  });

  it('renders an image chip', () => {
    const chips: readonly AttachmentChipBlock[] = [
      {
        type: 'attachment_chip',
        kind: 'image',
        name: 'shot.png',
        mimeType: 'image/png',
        size: 1234,
      },
    ];
    const { container } = render(<SentAttachmentList chips={chips} />);
    const item = container.querySelector('[data-slot="sent-attachment"]');
    expect(item).not.toBeNull();
    expect(item?.getAttribute('data-kind')).toBe('image');
    expect(container.textContent).toContain('shot.png');
  });

  it('renders a document chip', () => {
    const chips: readonly AttachmentChipBlock[] = [
      {
        type: 'attachment_chip',
        kind: 'document',
        name: 'notes.md',
        mimeType: 'text/markdown',
        size: 200,
      },
    ];
    const { container } = render(<SentAttachmentList chips={chips} />);
    const item = container.querySelector('[data-slot="sent-attachment"]');
    expect(item?.getAttribute('data-kind')).toBe('document');
    expect(container.textContent).toContain('notes.md');
  });
});
