import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProgressLines } from './ProgressLines';
import { RunStateStore } from '@/chat/runStateStore';
import type { ProgressEvent } from '@/chat/runStateStore';

function withProgress(events: readonly ProgressEvent[]): RunStateStore {
  const rs = new RunStateStore();
  for (const ev of events) rs.appendProgress(ev.toolUseId, ev);
  return rs;
}

const meta: Meta<typeof ProgressLines> = {
  title: 'Chat/Blocks/ProgressLines',
  component: ProgressLines,
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof ProgressLines>;

export const BashTailing: Story = {
  args: {
    toolUseId: 't',
    runState: withProgress([
      { kind: 'bash', toolUseId: 't', stdout: 'Running 247 tests…' },
      { kind: 'bash', toolUseId: 't', stdout: '✓ chat/messageStore.test.ts' },
      { kind: 'bash', toolUseId: 't', stdout: '✓ rag/scorer.test.ts' },
    ]),
  },
};

export const BashWithExit: Story = {
  args: {
    toolUseId: 't',
    runState: withProgress([
      { kind: 'bash', toolUseId: 't', stdout: 'Tests done' },
      { kind: 'bash', toolUseId: 't', exitCode: 0 },
    ]),
  },
};

export const WebSearchProgress: Story = {
  args: {
    toolUseId: 't',
    runState: withProgress([
      { kind: 'web_search', toolUseId: 't', query: 'obsidian plugin api', resultsSoFar: 8 },
    ]),
  },
};

export const McpToolCall: Story = {
  args: {
    toolUseId: 't',
    runState: withProgress([
      { kind: 'mcp', toolUseId: 't', serverName: 'git', methodCall: 'tools/call' },
      { kind: 'mcp', toolUseId: 't', serverName: 'git', methodCall: 'staging files…' },
    ]),
  },
};

export const SkillProgress: Story = {
  args: {
    toolUseId: 't',
    runState: withProgress([
      { kind: 'skill', toolUseId: 't', skillName: 'plan-feature', status: 'analyzing' },
      { kind: 'skill', toolUseId: 't', skillName: 'plan-feature', status: 'slicing' },
    ]),
  },
};

export const OverflowTruncated: Story = {
  args: {
    toolUseId: 't',
    maxVisible: 3,
    runState: withProgress(
      Array.from({ length: 12 }).map((_, i) => ({
        kind: 'bash' as const,
        toolUseId: 't',
        stdout: `line ${i}`,
      })),
    ),
  },
};
