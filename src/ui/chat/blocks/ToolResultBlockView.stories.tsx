import type { Meta, StoryObj } from '@storybook/react-vite';
import { ToolResultBlockView } from './ToolResultBlockView';
import { RunStateStore } from '@/chat/runStateStore';
import type { ToolResultBlock, ToolUseBlock } from '@/chat/types';

const tu = (over: Partial<ToolUseBlock> = {}): ToolUseBlock => ({
  type: 'tool_use',
  id: 't1',
  name: 'Read',
  input: { path: 'README.md' },
  ...over,
});

const tr = (over: Partial<ToolResultBlock> = {}): ToolResultBlock => ({
  type: 'tool_result',
  tool_use_id: 't1',
  content: '# Leo\n\nLocal-first agent.',
  ...over,
});

const meta: Meta<typeof ToolResultBlockView> = {
  title: 'Chat/Blocks/ToolResultBlockView',
  component: ToolResultBlockView,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Tool result panel. Successful long results auto-collapse with a "show more" toggle ' +
          'so transcripts stay scannable; errors expand by default for visibility.',
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof ToolResultBlockView>;

export const SuccessShort: Story = {
  name: 'Success · short (always expanded)',
  args: { block: tr({ content: 'pong' }), associatedToolUse: tu() },
};

export const SuccessLongCollapsed: Story = {
  name: 'Success · long (auto-collapsed, show more)',
  args: {
    block: tr({ content: 'a'.repeat(5000) }),
    associatedToolUse: tu(),
  },
};

export const SuccessLongLowThreshold: Story = {
  name: 'Success · custom collapse threshold',
  args: {
    block: tr({ content: 'one\ntwo\nthree\nfour\nfive\nsix' }),
    associatedToolUse: tu(),
    defaultCollapseAtChars: 8,
  },
};

export const Errored: Story = {
  args: {
    block: tr({ content: '/bin/sh: missing-cmd: not found', is_error: true }),
    associatedToolUse: tu({ name: 'Bash' }),
  },
};

export const Rejected: Story = {
  args: {
    block: tr({ content: 'user denied editNote' }),
    associatedToolUse: tu({ name: 'editNote', decision: 'deny' }),
    runState: new RunStateStore(),
  },
};

export const Canceled: Story = {
  args: {
    block: tr({ content: '(canceled)' }),
    associatedToolUse: tu({ name: 'Bash' }),
    runState: (() => {
      const rs = new RunStateStore();
      rs.markRunning('t1');
      rs.markCanceled('t1');
      return rs;
    })(),
  },
};

export const OrphanResult: Story = {
  args: { block: tr({ tool_use_id: 'never-existed' }) },
};
