import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { AttachmentTray } from './AttachmentTray';
import { makeStagedAttachment, mockSetIcon } from './__stories__/mocks/sources';

const meta: Meta<typeof AttachmentTray> = {
  title: 'Chat/AttachmentTray',
  component: AttachmentTray,
  args: {
    items: [],
    onRemove: fn(),
    setIcon: mockSetIcon,
  },
};
export default meta;

type Story = StoryObj<typeof AttachmentTray>;

export const Empty: Story = {};

export const Single: Story = {
  args: { items: [makeStagedAttachment({ kind: 'image', name: 'shot.png' })] },
};

export const Three: Story = {
  args: {
    items: [
      makeStagedAttachment({ kind: 'image', name: 'shot.png', size: 84_000 }),
      makeStagedAttachment({ kind: 'document', name: 'spec.pdf', size: 1_200_000 }),
      makeStagedAttachment({ kind: 'document', name: 'notes.md', size: 2_400 }),
    ],
  },
};

export const Full: Story = {
  args: {
    items: [
      makeStagedAttachment({ kind: 'image', name: 'a.png' }),
      makeStagedAttachment({ kind: 'image', name: 'b.jpg' }),
      makeStagedAttachment({ kind: 'document', name: 'c.pdf' }),
      makeStagedAttachment({ kind: 'document', name: 'd.md' }),
    ],
  },
};
