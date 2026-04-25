import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { ComposerInput } from './ComposerInput';
import { mockMatchMedia, mockSetIcon } from './__stories__/mocks/sources';

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
