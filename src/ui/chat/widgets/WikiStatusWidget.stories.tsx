import type { Meta, StoryObj } from '@storybook/react-vite';
import { WikiStatusWidget, type WikiStatusWidgetPayload } from './WikiStatusWidget';
import type { WikiStatus } from '@/agent/wiki/wikiStatus';

function status(overrides: Partial<WikiStatus> = {}): WikiStatus {
  return {
    indexPageCount: 124,
    indexSizeBytes: 18_432,
    lastLintTimestamp: '2026-04-28T09:30:00Z',
    lastLintRunId: 'lnt-15',
    orphanPageCount: 2,
    orphanRawCount: 1,
    mutexState: { kind: 'idle' },
    ...overrides,
  };
}

function payload(s: WikiStatus): WikiStatusWidgetPayload {
  return { status: s };
}

const meta: Meta<typeof WikiStatusWidget> = {
  title: 'Chat/Widgets/WikiStatusWidget',
  component: WikiStatusWidget,
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof WikiStatusWidget>;

export const Idle: Story = {
  args: { props: payload(status()) },
};

export const NeverLinted: Story = {
  args: {
    props: payload(status({ lastLintTimestamp: null, lastLintRunId: null })),
  },
};

export const IngestRunning: Story = {
  args: {
    props: payload(
      status({
        mutexState: { kind: 'busy', op: 'ingest', runId: 'ing-42' },
      }),
    ),
  },
};

export const LintRunning: Story = {
  args: {
    props: payload(
      status({
        mutexState: { kind: 'busy', op: 'lint', runId: 'lnt-9' },
      }),
    ),
  },
};

export const EmptyVault: Story = {
  args: {
    props: payload(
      status({
        indexPageCount: 0,
        indexSizeBytes: 0,
        orphanPageCount: 0,
        orphanRawCount: 0,
        lastLintTimestamp: null,
        lastLintRunId: null,
      }),
    ),
  },
};
