import type { Meta, StoryObj } from '@storybook/react-vite';
import { SentAttachmentList } from './SentAttachmentList';
import { mockSetIcon } from './__stories__/mocks/sources';
import type { ContentBlock } from '@/chat/types';

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEX///+nxBvIAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=';

const blocks: readonly ContentBlock[] = [
  { type: 'text', text: 'attached for review' },
  {
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: TINY_PNG_BASE64 },
    name: 'screenshot.png',
    size: 84_320,
  },
  {
    type: 'document',
    source: { type: 'base64', media_type: 'text/markdown', data: 'IyBub3Rlcw==' },
    name: 'notes.md',
    size: 1_400,
  },
  {
    type: 'document',
    source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0=' },
    name: 'spec.pdf',
    size: 1_200_000,
  },
];

const meta: Meta<typeof SentAttachmentList> = {
  title: 'Chat/SentAttachmentList',
  component: SentAttachmentList,
  args: {
    blocks,
    setIcon: mockSetIcon,
  },
};
export default meta;

type Story = StoryObj<typeof SentAttachmentList>;

export const Mixed: Story = {};

export const ImageOnly: Story = {
  args: { blocks: [blocks[1]!] },
};

export const DocumentsOnly: Story = {
  args: { blocks: [blocks[2]!, blocks[3]!] },
};

export const Empty: Story = {
  args: { blocks: [{ type: 'text', text: 'no attachments here' }] },
};
