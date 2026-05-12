import type { Meta, StoryObj } from '@storybook/react-vite';
import { GroupedToolUses } from './GroupedToolUses';
import type { GroupedToolPair } from '@/chat/groupReadOnly';
import { RunStateStore } from '@/chat/runStateStore';
import type { ToolResultBlock, ToolUseBlock } from '@/chat/types';

function block(id: string, path: string, name = 'readNote'): ToolUseBlock {
  return { type: 'tool_use', id, name, input: { path } };
}

function resultBlock(id: string, body: string): ToolResultBlock {
  return { type: 'tool_result', tool_use_id: id, content: body };
}

function pair(id: string, path: string, body?: string, name = 'readNote'): GroupedToolPair {
  const toolUse = block(id, path, name);
  return {
    toolUse,
    toolUseIndex: 0,
    ...(body !== undefined ? { result: resultBlock(id, body), resultIndex: 1 } : {}),
  };
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
    pairs: [
      pair('1', 'README.md', '# Readme\n\nLeo is a plugin.'),
      pair('2', 'foo.md', 'foo contents'),
      pair('3', 'bar.md', 'bar contents'),
      pair('4', 'notes/baz.md', 'baz contents'),
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
    pairs: [
      {
        toolUse: { type: 'tool_use', id: 's1', name: 'searchVault', input: { query: 'leo' } },
        toolUseIndex: 0,
        result: resultBlock('s1', '3 matches'),
        resultIndex: 1,
      },
      {
        toolUse: { type: 'tool_use', id: 's2', name: 'searchVault', input: { query: 'plugin' } },
        toolUseIndex: 2,
        result: resultBlock('s2', '1 match'),
        resultIndex: 3,
      },
    ],
    slots: { runState: resolvedRs(['s1', 's2']) },
    defaultCollapsed: false,
  },
};
