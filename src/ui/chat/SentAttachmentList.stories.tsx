import type { Meta, StoryObj } from '@storybook/react-vite';
import { SentAttachmentList } from './SentAttachmentList';
import { mockSetIcon } from './__stories__/mocks/sources';
import type { AttachmentChipBlock } from '@/chat/types';

const chips: readonly AttachmentChipBlock[] = [
  {
    type: 'attachment_chip',
    kind: 'image',
    name: 'screenshot.png',
    mimeType: 'image/png',
    size: 84_320,
  },
  {
    type: 'attachment_chip',
    kind: 'document',
    name: 'notes.md',
    mimeType: 'text/markdown',
    size: 1_400,
  },
  {
    type: 'attachment_chip',
    kind: 'document',
    name: 'spec.pdf',
    mimeType: 'application/pdf',
    size: 1_200_000,
  },
];

const meta: Meta<typeof SentAttachmentList> = {
  title: 'Chat/SentAttachmentList',
  component: SentAttachmentList,
  args: {
    chips,
    setIcon: mockSetIcon,
  },
};
export default meta;

type Story = StoryObj<typeof SentAttachmentList>;

export const Mixed: Story = {};

export const ImageOnly: Story = {
  args: { chips: [chips[0]!] },
};

export const DocumentsOnly: Story = {
  args: { chips: [chips[1]!, chips[2]!] },
};

export const Empty: Story = {
  args: { chips: [] },
};
