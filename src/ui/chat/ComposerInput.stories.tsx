import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { ComposerInput } from './ComposerInput';
import { makeStagedAttachment, mockMatchMedia, mockSetIcon } from './__stories__/mocks/sources';

const slashCommands = [
  { name: 'clear', description: 'Clear the current thread' },
  { name: 'plan', description: 'Start planning mode' },
  { name: 'context', description: 'Show the focused editor context' },
  { name: 'thread', description: 'Switch or create a thread' },
  { name: 'skill', description: 'Invoke a skill' },
];

const meta: Meta<typeof ComposerInput> = {
  title: 'Chat/ComposerInput',
  component: ComposerInput,
  args: {
    collapsed: false,
    isSubmitting: false,
    queueLength: 0,
    slashCommands,
    onSubmit: fn(),
    onStopIntent: fn(),
    onOpenCommandPalette: fn(),
    setIcon: mockSetIcon,
    matchMedia: mockMatchMedia,
  },
};
export default meta;

type Story = StoryObj<typeof ComposerInput>;

export const Default: Story = {};

export const Collapsed: Story = { args: { collapsed: true } };

export const Submitting: Story = { args: { isSubmitting: true } };

export const WithQueue: Story = { args: { queueLength: 3 } };

export const ConfirmationOpen: Story = { args: { inlineConfirmationOpen: true } };

export const WithAttachments: Story = {
  args: {
    attachments: [
      makeStagedAttachment({ kind: 'image', name: 'shot.png', size: 84_000 }),
      makeStagedAttachment({ kind: 'document', name: 'spec.pdf', size: 1_200_000 }),
    ],
    onAttachmentRemove: fn(),
    onPickFiles: fn(),
    onCaptureFiles: fn(),
  },
};

export const WithRejections: Story = {
  args: {
    onPickFiles: fn(),
    attachmentRejections: [
      { name: 'big.mp4', reason: { kind: 'oversize', size: 25 * 1024 * 1024 } },
      { name: 'photo.jpg', reason: { kind: 'vision_blocked' } },
    ],
    onDismissAttachmentRejections: fn(),
  },
};
