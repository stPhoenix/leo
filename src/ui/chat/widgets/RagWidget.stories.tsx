import type { Meta, StoryObj } from '@storybook/react-vite';
import { RagWidget, type RagWidgetPayload } from './RagWidget';
import type { RagSnapshot } from '@/rag/ragSnapshot';
import type { IndexerStatusSnapshot } from '@/indexer/indexerStatusTap';

const IDLE_INDEXER: IndexerStatusSnapshot = {
  phase: 'idle',
  remaining: 0,
  currentPath: null,
  lastError: null,
};

function snapshot(overrides: Partial<RagSnapshot> = {}): RagSnapshot {
  return {
    storeAvailable: true,
    storeUnavailableReason: null,
    filesIndexed: 1284,
    chunkCount: 12_930,
    model: 'nomic-embed-text-v1.5',
    dim: 768,
    vectorBytesApprox: 12_930 * 768 * 4,
    textBytesApprox: 38_000_000,
    indexerStatus: IDLE_INDEXER,
    excludePatternCount: 7,
    graphNodeCount: 1_210,
    ...overrides,
  };
}

function payload(snap: RagSnapshot): RagWidgetPayload {
  return { snapshot: snap };
}

const meta: Meta<typeof RagWidget> = {
  title: 'Chat/Widgets/RagWidget',
  component: RagWidget,
  parameters: {
    layout: 'padded',
  },
};
export default meta;

type Story = StoryObj<typeof RagWidget>;

export const Idle: Story = {
  args: {
    props: payload(snapshot()),
  },
};

export const IndexingInProgress: Story = {
  args: {
    props: payload(
      snapshot({
        filesIndexed: 1147,
        chunkCount: 11_410,
        vectorBytesApprox: 11_410 * 768 * 4,
        indexerStatus: {
          phase: 'draining',
          remaining: 137,
          currentPath: 'daily/2026-04-26.md',
          lastError: null,
        },
      }),
    ),
  },
};

export const PausedOnUser: Story = {
  args: {
    props: payload(
      snapshot({
        indexerStatus: {
          phase: 'paused-on-user',
          remaining: 23,
          currentPath: null,
          lastError:
            'Indexer paused — embedding model changed; choose Re-index now or revert in settings.',
        },
      }),
    ),
  },
};

export const Errored: Story = {
  args: {
    props: payload(
      snapshot({
        indexerStatus: {
          phase: 'errored',
          remaining: 4,
          currentPath: 'broken/binary.md',
          lastError: 'embedding provider returned 503',
        },
      }),
    ),
  },
};

export const Unavailable: Story = {
  args: {
    props: payload(
      snapshot({
        storeAvailable: false,
        storeUnavailableReason: 'open-failed',
        filesIndexed: 0,
        chunkCount: 0,
        model: null,
        dim: null,
        vectorBytesApprox: 0,
        textBytesApprox: null,
      }),
    ),
  },
};

export const Empty: Story = {
  args: {
    props: payload(
      snapshot({
        filesIndexed: 0,
        chunkCount: 0,
        vectorBytesApprox: 0,
        textBytesApprox: null,
        graphNodeCount: 0,
        excludePatternCount: 0,
      }),
    ),
  },
};

export const LargeVault: Story = {
  args: {
    props: payload(
      snapshot({
        filesIndexed: 18_502,
        chunkCount: 412_700,
        vectorBytesApprox: 412_700 * 768 * 4,
        textBytesApprox: 1_350_000_000,
        graphNodeCount: 17_980,
        excludePatternCount: 24,
      }),
    ),
  },
};
