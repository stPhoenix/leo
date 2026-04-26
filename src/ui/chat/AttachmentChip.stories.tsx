import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { AttachmentChip } from './AttachmentChip';
import { makeStagedAttachment, mockSetIcon } from './__stories__/mocks/sources';

const meta: Meta<typeof AttachmentChip> = {
  title: 'Chat/AttachmentChip',
  component: AttachmentChip,
  args: {
    attachment: makeStagedAttachment({ kind: 'image', name: 'screenshot.png', size: 184_320 }),
    onRemove: fn(),
    setIcon: mockSetIcon,
  },
};
export default meta;

type Story = StoryObj<typeof AttachmentChip>;

export const ImageWithThumb: Story = {
  args: {
    attachment: makeStagedAttachment({
      kind: 'image',
      name: 'diagram.png',
      size: 240_000,
      previewUrl:
        'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="%237aa6ff"/><circle cx="20" cy="20" r="10" fill="%23fff"/></svg>',
    }),
  },
};

export const ImageNoPreview: Story = {};

export const PdfDocument: Story = {
  args: {
    attachment: makeStagedAttachment({
      kind: 'document',
      name: 'requirements-v3.pdf',
      mimeType: 'application/pdf',
      size: 980_000,
    }),
  },
};

export const TextDocument: Story = {
  args: {
    attachment: makeStagedAttachment({
      kind: 'document',
      name: 'notes.md',
      mimeType: 'text/markdown',
      size: 1_400,
    }),
  },
};

export const LongName: Story = {
  args: {
    attachment: makeStagedAttachment({
      kind: 'document',
      name: 'a-really-long-filename-that-should-truncate-gracefully-in-the-chip.md',
      mimeType: 'text/markdown',
      size: 8_200,
    }),
  },
};

export const WithoutRemove: Story = { args: { onRemove: undefined } };
