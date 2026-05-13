import type { Meta, StoryObj } from '@storybook/react-vite';
import { SubagentWidget } from './SubagentLiveBlock';
import { TaskWidgetController } from '@/agent/task/widgetController';
import type { TaskErrorCode, TaskPhase, TaskViewModel } from '@/agent/task/widgetState';

function ctrl(patch: Partial<TaskViewModel>): TaskWidgetController {
  const c = new TaskWidgetController({
    runId: 'task-20260513-101500-abc123',
    threadId: 't1',
    prompt: 'Count .ts files under src/agent/ that reference EventChannel.',
  });
  c.update(patch);
  return c;
}

const meta: Meta<typeof SubagentWidget> = {
  title: 'Chat/Blocks/SubagentWidget',
  component: SubagentWidget,
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof SubagentWidget>;

const NOW = Date.now();

export const Preparing: Story = {
  args: {
    controller: ctrl({ phase: 'preparing', startedAt: NOW - 120 }),
  },
};

export const Running: Story = {
  args: {
    controller: ctrl({
      phase: 'running',
      startedAt: NOW - 1500,
      toolCallsCount: 3,
      lastToolId: 'grep_vault',
    }),
  },
};

export const Summarizing: Story = {
  args: {
    controller: ctrl({
      phase: 'summarizing',
      startedAt: NOW - 4200,
      toolCallsCount: 7,
      lastToolId: 'read_note',
    }),
  },
};

export const Done: Story = {
  args: {
    controller: ctrl({
      phase: 'done',
      startedAt: NOW - 5400,
      endedAt: NOW,
      toolCallsCount: 7,
      lastToolId: 'read_note',
      summary: '17',
    }),
  },
};

export const Cancelled: Story = {
  args: {
    controller: ctrl({
      phase: 'cancelled',
      startedAt: NOW - 800,
      endedAt: NOW,
      toolCallsCount: 2,
      error: { code: 'cancelled', message: 'Task subagent run cancelled' },
    }),
  },
};

function err(code: TaskErrorCode, message: string, phase: TaskPhase = 'error'): Story {
  return {
    args: {
      controller: ctrl({
        phase,
        startedAt: NOW - 800,
        endedAt: NOW,
        error: { code, message },
      }),
    },
  };
}

export const ErrorNoSummary: Story = err('no_summary', 'subagent produced no final text');
export const ErrorTimeout: Story = err('timeout', 'Subagent run exceeded timeout');
export const ErrorReload: Story = err('reload', 'Task subagent run discarded by plugin reload');
