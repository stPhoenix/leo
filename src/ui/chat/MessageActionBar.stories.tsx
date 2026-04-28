import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import type { ChatMessageRecord } from '@/chat/types';
import { MessageActionBar } from './MessageActionBar';
import { mockSetIcon } from './__stories__/mocks/sources';

const userRecord: ChatMessageRecord = {
  id: 'u1',
  role: 'user',
  content: 'Summarize today note',
  createdAt: '2026-04-24T10:00:00Z',
};

const assistantRecord: ChatMessageRecord = {
  id: 'a1',
  role: 'assistant',
  content: 'Here is a summary...',
  createdAt: '2026-04-24T10:00:01Z',
  status: 'done',
};

const meta: Meta<typeof MessageActionBar> = {
  title: 'Chat/MessageActionBar',
  component: MessageActionBar,
  args: {
    setIcon: mockSetIcon,
    actions: {
      copy: fn(),
      delete: fn(),
      regenerate: fn(),
      editAndResend: fn(),
    },
    onStartEdit: fn(),
  },
  decorators: [
    (Story) => (
      <div className="leo-bubble" data-storybook-force-actions style={{ padding: 12 }}>
        <style>{`[data-storybook-force-actions] .leo-message-actions { opacity: 1; pointer-events: auto; }`}</style>
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof MessageActionBar>;

export const UserMessage: Story = { args: { record: userRecord } };

export const AssistantMessage: Story = { args: { record: assistantRecord } };

export const AssistantWithoutRegenerate: Story = {
  args: {
    record: assistantRecord,
    actions: { copy: fn(), delete: fn() },
  },
};

export const UserWithoutEdit: Story = {
  args: {
    record: userRecord,
    actions: { copy: fn(), delete: fn() },
  },
};
