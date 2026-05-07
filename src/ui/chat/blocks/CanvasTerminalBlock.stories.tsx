import type { Meta, StoryObj } from '@storybook/react-vite';
import { CanvasTerminalBlock } from './CanvasTerminalBlock';
import type { WidgetComponentProps } from '../widgets/registry';

const meta: Meta<typeof CanvasTerminalBlock> = {
  title: 'Chat/Blocks/CanvasTerminalBlock',
  component: CanvasTerminalBlock,
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof CanvasTerminalBlock>;

const baseProps = {
  schemaVersion: 1,
  runId: '20260505-120000-abc123',
  threadId: 't1',
  targetPath: 'canvases/example.canvas',
  durationMs: 12_345,
  createdAt: 1_700_000_000_000,
  failedSources: [],
  nodeCount: 12,
  edgeCount: 18,
} as const;

function args(props: Record<string, unknown>): WidgetComponentProps {
  return { props };
}

export const DoneWithInsights: Story = {
  args: args({
    ...baseProps,
    op: 'create',
    outcome: 'done',
    phaseAtTerminal: 'done',
    insights: {
      hubs: [{ id: 'e1', name: 'Alice', degree: 5 }],
      components: { count: 2, sizes: [8, 3] },
      orphans: [],
      perTypeCount: { person: 8, team: 4 },
    },
  }),
};

export const DoneEmptyGraph: Story = {
  args: args({
    ...baseProps,
    op: 'create',
    outcome: 'done',
    phaseAtTerminal: 'done',
    nodeCount: 0,
    edgeCount: 0,
  }),
};

export const Cancelled: Story = {
  args: args({
    ...baseProps,
    op: 'content_edit',
    outcome: 'cancelled',
    phaseAtTerminal: 'previewing',
  }),
};

export const ErrorReduceInvalid: Story = {
  args: args({
    ...baseProps,
    op: 'create',
    outcome: 'error',
    phaseAtTerminal: 'reducing',
    error: { code: 'reduce_invalid', message: 'Schema check failed' },
  }),
};

export const ErrorReload: Story = {
  args: args({
    ...baseProps,
    op: 'create',
    outcome: 'error',
    phaseAtTerminal: 'preparing',
    error: { code: 'reload', message: 'Run discarded by plugin reload' },
  }),
};

export const PartialWithFailedSources: Story = {
  args: args({
    ...baseProps,
    op: 'create',
    outcome: 'done',
    phaseAtTerminal: 'done',
    failedSources: [
      { ref: 'a.md', code: 'fetch_vault_missing', message: 'note not found' },
      { ref: 'b.md', code: 'extract_invalid', message: 'output schema mismatch' },
    ],
  }),
};

export const InvalidSnapshot: Story = {
  args: args({ schemaVersion: 99, runId: 'x' }),
};
