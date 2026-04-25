import type { Meta, StoryObj } from '@storybook/react-vite';
import { GroupedToolUses } from './GroupedToolUses';
import { RunStateStore } from '@/chat/runStateStore';
import type { ToolUseBlock } from '@/chat/types';

function block(id: string, path: string, name = 'readNote'): ToolUseBlock {
  return { type: 'tool_use', id, name, input: { path } };
}

function resolvedRs(ids: readonly string[]): RunStateStore {
  const rs = new RunStateStore();
  for (const id of ids) {
    rs.markRunning(id);
    rs.markResolved(id, false);
  }
  return rs;
}

const meta: Meta<typeof GroupedToolUses> = {
  title: 'Chat/Blocks/GroupedToolUses',
  component: GroupedToolUses,
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof GroupedToolUses>;

export const FourReadsCollapsed: Story = {
  args: {
    toolName: 'readNote',
    blocks: [
      block('1', 'README.md'),
      block('2', 'foo.md'),
      block('3', 'bar.md'),
      block('4', 'notes/baz.md'),
    ],
    slots: { runState: resolvedRs(['1', '2', '3', '4']) },
    defaultCollapsed: true,
  },
};

export const FourReadsExpanded: Story = {
  args: {
    ...FourReadsCollapsed.args,
    defaultCollapsed: false,
  },
};

export const TwoSearches: Story = {
  args: {
    toolName: 'searchVault',
    blocks: [
      { type: 'tool_use', id: 's1', name: 'searchVault', input: { query: 'leo' } },
      { type: 'tool_use', id: 's2', name: 'searchVault', input: { query: 'plugin' } },
    ],
    slots: { runState: resolvedRs(['s1', 's2']) },
    defaultCollapsed: false,
  },
};
