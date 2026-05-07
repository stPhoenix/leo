import type { Meta, StoryObj } from '@storybook/react-vite';
import { CompactTerminalBlock } from './CompactTerminalBlock';
import type { CompactTerminalSnapshot } from '@/agent/compact/terminalSnapshot';

function snap(patch: Partial<CompactTerminalSnapshot>): CompactTerminalSnapshot {
  return {
    schemaVersion: 1,
    runId: 'cmp-20260507-141500-abc123',
    threadId: 't1',
    trigger: 'manual',
    terminalPhase: 'done',
    durationMs: 5400,
    preTokens: 87_400,
    postTokens: 18_200,
    inputTokens: 84_900,
    outputTokens: 1_650,
    customInstructions: null,
    attachmentCount: 4,
    error: null,
    ...patch,
  };
}

const meta: Meta<typeof CompactTerminalBlock> = {
  title: 'Chat/Blocks/CompactTerminalBlock',
  component: CompactTerminalBlock,
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof CompactTerminalBlock>;

export const DoneManual: Story = { args: { props: snap({}) } };

export const DoneAuto: Story = {
  args: {
    props: snap({
      trigger: 'auto',
      durationMs: 7100,
      preTokens: 142_800,
      postTokens: 23_500,
      inputTokens: 138_200,
      outputTokens: 2_100,
      attachmentCount: 7,
    }),
  },
};

export const DoneWithCustomInstructions: Story = {
  args: {
    props: snap({
      customInstructions: 'Focus on the auth refactor; drop wiki ingest details.',
    }),
  },
};

export const Cancelled: Story = {
  args: {
    props: snap({
      terminalPhase: 'cancelled',
      durationMs: 1_200,
      postTokens: null,
      inputTokens: null,
      outputTokens: null,
      attachmentCount: null,
    }),
  },
};

export const ErrorCircuitBroken: Story = {
  args: {
    props: snap({
      terminalPhase: 'error',
      durationMs: 60,
      preTokens: null,
      postTokens: null,
      inputTokens: null,
      outputTokens: null,
      attachmentCount: null,
      error: {
        code: 'circuit_broken',
        message: 'Compaction disabled for this session (3 consecutive failures)',
      },
    }),
  },
};

export const ErrorPromptTooLong: Story = {
  args: {
    props: snap({
      terminalPhase: 'error',
      durationMs: 4_000,
      postTokens: null,
      inputTokens: null,
      outputTokens: null,
      attachmentCount: null,
      error: { code: 'prompt_too_long', message: 'Prompt too long even after head truncation' },
    }),
  },
};

export const ErrorReload: Story = {
  args: {
    props: snap({
      terminalPhase: 'error',
      durationMs: 0,
      preTokens: null,
      postTokens: null,
      inputTokens: null,
      outputTokens: null,
      attachmentCount: null,
      error: { code: 'reload', message: 'Compact run discarded by plugin reload' },
    }),
  },
};

export const InvalidProps: Story = {
  args: { props: { schemaVersion: 999, garbage: true } as unknown as CompactTerminalSnapshot },
};
