import type { Meta, StoryObj } from '@storybook/react-vite';
import { CompactWidget } from './CompactWidget';
import { CompactWidgetController } from '@/agent/compact/widgetController';
import type {
  CompactErrorCode,
  CompactPhase,
  CompactTrigger,
  CompactViewModel,
} from '@/agent/compact/widgetState';

function ctrl(trigger: CompactTrigger, patch: Partial<CompactViewModel>): CompactWidgetController {
  const c = new CompactWidgetController({
    runId: 'cmp-20260507-141500-abc123',
    threadId: 't1',
    trigger,
  });
  c.update(patch);
  return c;
}

const meta: Meta<typeof CompactWidget> = {
  title: 'Chat/Blocks/CompactWidget',
  component: CompactWidget,
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof CompactWidget>;

const NOW = Date.now();

export const Preparing: Story = {
  args: {
    controller: ctrl('manual', {
      phase: 'preparing',
      startedAt: NOW - 200,
      preTokens: 87_400,
    }),
  },
};

export const Summarizing: Story = {
  args: {
    controller: ctrl('manual', {
      phase: 'summarizing',
      startedAt: NOW - 1500,
      preTokens: 87_400,
    }),
  },
};

export const BuildingAttachments: Story = {
  args: {
    controller: ctrl('auto', {
      phase: 'building_attachments',
      startedAt: NOW - 4200,
      preTokens: 142_800,
    }),
  },
};

export const DoneManual: Story = {
  args: {
    controller: ctrl('manual', {
      phase: 'done',
      startedAt: NOW - 5400,
      endedAt: NOW,
      preTokens: 87_400,
      postTokens: 18_200,
      inputTokens: 84_900,
      outputTokens: 1_650,
      attachmentCount: 4,
    }),
  },
};

export const DoneAuto: Story = {
  args: {
    controller: ctrl('auto', {
      phase: 'done',
      startedAt: NOW - 7100,
      endedAt: NOW,
      preTokens: 142_800,
      postTokens: 23_500,
      inputTokens: 138_200,
      outputTokens: 2_100,
      attachmentCount: 7,
    }),
  },
};

export const Cancelled: Story = {
  args: {
    controller: ctrl('manual', {
      phase: 'cancelled',
      startedAt: NOW - 1200,
      endedAt: NOW,
      preTokens: 87_400,
    }),
  },
};

function err(code: CompactErrorCode, message: string, phase: CompactPhase = 'error'): Story {
  return {
    args: {
      controller: ctrl('manual', {
        phase,
        startedAt: NOW - 800,
        endedAt: NOW,
        error: { code, message },
      }),
    },
  };
}

export const ErrorCircuitBroken: Story = err(
  'circuit_broken',
  'Compaction disabled for this session (3 consecutive failures)',
);

export const ErrorNoStream: Story = err('no_stream', 'No streaming response from provider');

export const ErrorPromptTooLong: Story = err(
  'prompt_too_long',
  'Prompt is too long even after truncation',
);

export const ErrorEmptyHistory: Story = err('empty_history', 'No conversation to compact');

export const ErrorReload: Story = err('reload', 'Compact run discarded by plugin reload');
