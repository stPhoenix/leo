import type { Meta, StoryObj } from '@storybook/react-vite';
import { SubagentTerminalBlock } from './SubagentTerminalBlock';
import type { TaskTerminalSnapshot } from '@/agent/task/terminalSnapshot';

function snap(patch: Partial<TaskTerminalSnapshot>): TaskTerminalSnapshot {
  return {
    schemaVersion: 1,
    runId: 'task-20260513-101500-abc123',
    threadId: 't1',
    prompt: 'Count .ts files under src/agent/ that reference EventChannel.',
    terminalPhase: 'done',
    durationMs: 5400,
    toolCallsCount: 7,
    lastToolId: 'read_note',
    summary: '17',
    error: null,
    ...patch,
  };
}

const meta: Meta<typeof SubagentTerminalBlock> = {
  title: 'Chat/Blocks/SubagentTerminalBlock',
  component: SubagentTerminalBlock,
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof SubagentTerminalBlock>;

export const Done: Story = { args: { props: snap({}) } };

export const DoneNoToolCalls: Story = {
  args: { props: snap({ toolCallsCount: 0, lastToolId: null, summary: 'OK', durationMs: 800 }) },
};

export const Cancelled: Story = {
  args: {
    props: snap({
      terminalPhase: 'cancelled',
      summary: null,
      error: { code: 'cancelled', message: 'Task subagent run cancelled' },
      toolCallsCount: 2,
      durationMs: 1200,
    }),
  },
};

export const ErrorNoSummary: Story = {
  args: {
    props: snap({
      terminalPhase: 'error',
      summary: null,
      error: { code: 'no_summary', message: 'subagent produced no final text' },
      toolCallsCount: 8,
      durationMs: 9000,
    }),
  },
};

export const ErrorReload: Story = {
  args: {
    props: snap({
      terminalPhase: 'error',
      summary: null,
      error: { code: 'reload', message: 'Task subagent run discarded by plugin reload' },
      toolCallsCount: 1,
      durationMs: 0,
    }),
  },
};

export const InvalidProps: Story = {
  args: { props: { schemaVersion: 999, garbage: true } as unknown as TaskTerminalSnapshot },
};
