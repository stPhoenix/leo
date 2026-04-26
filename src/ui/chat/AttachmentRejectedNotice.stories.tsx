import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { AttachmentRejectedNotice } from './AttachmentRejectedNotice';

const meta: Meta<typeof AttachmentRejectedNotice> = {
  title: 'Chat/AttachmentRejectedNotice',
  component: AttachmentRejectedNotice,
  args: {
    rejections: [],
    onDismiss: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof AttachmentRejectedNotice>;

export const Hidden: Story = {};

export const Oversize: Story = {
  args: {
    rejections: [{ name: 'big-video.mp4', reason: { kind: 'oversize', size: 25 * 1024 * 1024 } }],
  },
};

export const LimitReached: Story = {
  args: {
    rejections: [{ name: 'extra.png', reason: { kind: 'limit_reached', currentCount: 4 } }],
  },
};

export const UnsupportedMime: Story = {
  args: {
    rejections: [
      {
        name: 'design.sketch',
        reason: { kind: 'unsupported_mime', mimeType: 'application/octet-stream' },
      },
    ],
  },
};

export const VisionBlocked: Story = {
  args: {
    rejections: [{ name: 'photo.jpg', reason: { kind: 'vision_blocked' } }],
  },
};

export const Multiple: Story = {
  args: {
    rejections: [
      { name: 'a.mp4', reason: { kind: 'oversize', size: 30 * 1024 * 1024 } },
      { name: 'b.png', reason: { kind: 'limit_reached', currentCount: 4 } },
      { name: 'c.exe', reason: { kind: 'unsupported_mime', mimeType: 'application/x-msdownload' } },
    ],
  },
};
