import type { Meta, StoryObj } from '@storybook/react-vite';
import { InlinePermissionPrompt } from './InlinePermissionPrompt';
import { RunStateStore } from '@/chat/runStateStore';
import type { ToolUseBlock } from '@/chat/types';

function makeBlock(over: Partial<ToolUseBlock> = {}): ToolUseBlock {
  return { type: 'tool_use', id: 't1', name: 'editNote', input: { path: 'foo.md' }, ...over };
}

function pending(category: 'read' | 'write'): RunStateSource {
  const rs = new RunStateStore();
  rs.recordPermissionRequest('t1', {
    toolUseId: 't1',
    toolId: 'editNote',
    thread: 'th',
    argsJson: '{"path":"foo.md"}',
    category,
  });
  return rs;
}

import type { RunStateSource } from './toolUseStatus';

const meta: Meta<typeof InlinePermissionPrompt> = {
  title: 'Chat/Blocks/InlinePermissionPrompt',
  component: InlinePermissionPrompt,
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof InlinePermissionPrompt>;

export const PendingRead: Story = {
  args: {
    block: makeBlock({ name: 'readNote' }),
    runState: pending('read'),
    onResolve: () => undefined,
  },
};

export const PendingWrite: Story = {
  args: { block: makeBlock(), runState: pending('write'), onResolve: () => undefined },
};

export const HistoricalAllowedOnce: Story = {
  args: {
    block: makeBlock({ decision: 'allow-once' }),
    runState: new RunStateStore(),
    onResolve: () => undefined,
  },
};

export const HistoricalAllowedThread: Story = {
  args: {
    block: makeBlock({ decision: 'allow-thread' }),
    runState: new RunStateStore(),
    onResolve: () => undefined,
  },
};

export const HistoricalDenied: Story = {
  args: {
    block: makeBlock({ decision: 'deny' }),
    runState: new RunStateStore(),
    onResolve: () => undefined,
  },
};
