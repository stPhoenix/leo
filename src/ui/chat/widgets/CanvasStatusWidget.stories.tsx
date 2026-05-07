import type { Meta, StoryObj } from '@storybook/react-vite';
import { CanvasStatusWidget } from './CanvasStatusWidget';
import type { CanvasStatus } from '@/agent/canvas/canvasStatus';
import type { WidgetComponentProps } from './registry';

const meta: Meta<typeof CanvasStatusWidget> = {
  title: 'Chat/Widgets/CanvasStatusWidget',
  component: CanvasStatusWidget,
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof CanvasStatusWidget>;

function args(status: CanvasStatus): WidgetComponentProps {
  return { props: { status } };
}

export const Idle: Story = {
  args: args({ activeRuns: [], recentSidecars: [], sidecarDirError: null }),
};

export const OneActiveRun: Story = {
  args: args({
    activeRuns: [{ path: 'canvases/people.canvas', runId: '20260505-120000-abc123', op: 'create' }],
    recentSidecars: [],
    sidecarDirError: null,
  }),
};

export const Mixed: Story = {
  args: args({
    activeRuns: [
      { path: 'canvases/orgchart.canvas', runId: '20260505-130000-deadbe', op: 'content_edit' },
    ],
    recentSidecars: [
      {
        slug: 'people-abc123',
        leaf: 'people',
        runId: '20260504-110000-xyz999',
        lastRunAt: '2026-05-04T11:00:00.000Z',
      },
      {
        slug: 'topics-def456',
        leaf: 'topics',
        runId: '20260503-090000-mno789',
        lastRunAt: '2026-05-03T09:00:00.000Z',
      },
    ],
    sidecarDirError: null,
  }),
};

export const Error: Story = {
  args: args({
    activeRuns: [],
    recentSidecars: [],
    sidecarDirError: 'permission denied',
  }),
};
