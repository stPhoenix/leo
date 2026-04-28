import { useEffect, useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import {
  IndexStatusBlock,
  type IndexProgressSnapshot,
  type IndexStatusBlockProps,
} from './IndexStatusBlock';
import type { DrainEvent, DrainListener } from '@/indexer/vaultIndexer';
import { makeIndexSource } from './__stories__/mocks/sources';

const meta: Meta<typeof IndexStatusBlock> = {
  title: 'Chat/IndexStatusBlock',
  component: IndexStatusBlock,
  args: {
    onReindexAll: fn(),
    onReindexChanged: fn(),
  },
  parameters: {
    layout: 'padded',
  },
};
export default meta;

type Story = StoryObj<typeof IndexStatusBlock>;

function snapshot(partial: Partial<IndexProgressSnapshot>): IndexProgressSnapshot {
  return {
    busy: false,
    indexed: 0,
    total: 0,
    currentPath: null,
    dirty: 0,
    errors: [],
    completedAt: null,
    ...partial,
  };
}

export const NotIndexed: Story = {
  args: {
    source: makeIndexSource(false),
  },
};

export const DirtyNotes: Story = {
  args: {
    source: makeIndexSource(true),
    progressOverride: snapshot({ dirty: 7 }),
  },
};

export const DirtyOneNote: Story = {
  args: {
    source: makeIndexSource(true),
    progressOverride: snapshot({ dirty: 1 }),
  },
};

export const Indexing: Story = {
  args: {
    source: makeIndexSource(true),
    progressOverride: snapshot({
      busy: true,
      indexed: 471,
      total: 1284,
      currentPath: 'projects/Q2-roadmap/research/competitive-analysis.md',
    }),
  },
};

export const IndexingNearComplete: Story = {
  args: {
    source: makeIndexSource(true),
    progressOverride: snapshot({
      busy: true,
      indexed: 1280,
      total: 1284,
      currentPath: 'archive/2024/notes/last.md',
    }),
  },
};

export const IndexingWithErrors: Story = {
  args: {
    source: makeIndexSource(true),
    progressOverride: snapshot({
      busy: true,
      indexed: 220,
      total: 500,
      currentPath: 'inbox/draft.md',
      errors: [
        { path: 'broken/binary.md', message: 'invalid utf-8 sequence' },
        { path: 'archive/empty.md', message: 'embedding provider returned 503' },
      ],
    }),
  },
};

export const ProviderUnavailable: Story = {
  args: {
    source: makeIndexSource(false),
    progressOverride: snapshot({
      errors: [
        { message: 'Embedding provider unavailable — check provider connection and try again.' },
      ],
    }),
  },
  parameters: {
    docs: {
      description: {
        story: 'Indexing bailed before any file was processed (e.g. provider not connected).',
      },
    },
  },
};

export const ErrorsAfterIndex: Story = {
  args: {
    source: makeIndexSource(true),
    progressOverride: snapshot({
      indexed: 498,
      total: 500,
      errors: [
        { path: 'broken/binary.md', message: 'invalid utf-8 sequence' },
        { path: 'archive/empty.md', message: 'embedding provider returned 503' },
        { path: 'archive/old/legacy-notes.md', message: 'request timed out after 30s' },
        { path: 'projects/leftovers.md', message: 'rate limit exceeded' },
      ],
    }),
  },
};

export const Completed: Story = {
  args: {
    source: makeIndexSource(true),
    progressOverride: snapshot({
      indexed: 1284,
      total: 1284,
      completedAt: Date.now(),
    }),
    completeToastMs: 1_000_000,
  },
};

export const AlreadyIndexed: Story = {
  args: {
    source: makeIndexSource(true),
  },
  parameters: {
    docs: { description: { story: 'Up-to-date and idle — block renders nothing.' } },
  },
};

interface DrainController {
  readonly subscribe: (l: DrainListener) => () => void;
  readonly emit: (e: DrainEvent) => void;
}

function makeDrainController(): DrainController {
  const listeners = new Set<DrainListener>();
  return {
    subscribe: (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    emit: (e) => {
      for (const l of listeners) l(e);
    },
  };
}

interface ScriptedHarnessProps {
  readonly initialHasIndex: boolean;
  readonly script: ReadonlyArray<{ delayMs: number; events: ReadonlyArray<DrainEvent> }>;
  readonly onAfterDone?: () => void;
  readonly blockProps?: Partial<IndexStatusBlockProps>;
}

function ScriptedHarness(props: ScriptedHarnessProps): JSX.Element {
  const drainRef = useRef<DrainController>(makeDrainController());
  const [hasIndex, setHasIndex] = useState<boolean>(props.initialHasIndex);
  const [running, setRunning] = useState<boolean>(false);

  const start = (): void => {
    if (running) return;
    setRunning(true);
    let acc = 0;
    for (const step of props.script) {
      acc += step.delayMs;
      setTimeout(() => {
        for (const ev of step.events) {
          drainRef.current.emit(ev);
          if (ev.kind === 'complete') {
            setHasIndex(true);
            setRunning(false);
            props.onAfterDone?.();
          }
        }
      }, acc);
    }
  };

  useEffect(() => {
    const t = setTimeout(start, 250);
    return () => clearTimeout(t);
  }, [start]);

  const source = {
    hasIndex: () => hasIndex,
    subscribe: (cb: () => void) => {
      const id = setInterval(cb, 100);
      return () => clearInterval(id);
    },
  };

  return (
    <div>
      <IndexStatusBlock
        source={source}
        drainSubscribe={drainRef.current.subscribe}
        onReindexAll={start}
        onReindexChanged={start}
        {...props.blockProps}
      />
      <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
        <em>Press the button or wait — the harness emits a scripted sequence of drain events.</em>
      </div>
    </div>
  );
}

export const InteractiveReindexHappyPath: Story = {
  render: () => (
    <ScriptedHarness
      initialHasIndex={false}
      script={[
        { delayMs: 0, events: [{ kind: 'start', size: 5 }] },
        { delayMs: 400, events: [{ kind: 'tick', path: 'inbox/a.md', remaining: 4 }] },
        { delayMs: 400, events: [{ kind: 'tick', path: 'inbox/b.md', remaining: 3 }] },
        { delayMs: 400, events: [{ kind: 'tick', path: 'projects/c.md', remaining: 2 }] },
        { delayMs: 400, events: [{ kind: 'tick', path: 'archive/d.md', remaining: 1 }] },
        { delayMs: 400, events: [{ kind: 'tick', path: 'archive/e.md', remaining: 0 }] },
        { delayMs: 200, events: [{ kind: 'complete', remaining: 0 }] },
      ]}
    />
  ),
};

export const InteractiveReindexWithErrors: Story = {
  render: () => (
    <ScriptedHarness
      initialHasIndex={false}
      script={[
        { delayMs: 0, events: [{ kind: 'start', size: 4 }] },
        { delayMs: 500, events: [{ kind: 'tick', path: 'inbox/a.md', remaining: 3 }] },
        {
          delayMs: 500,
          events: [
            { kind: 'error', path: 'broken/binary.md', message: 'invalid utf-8 sequence' },
            { kind: 'tick', path: 'broken/binary.md', remaining: 2 },
          ],
        },
        { delayMs: 500, events: [{ kind: 'tick', path: 'projects/c.md', remaining: 1 }] },
        {
          delayMs: 500,
          events: [
            { kind: 'error', path: 'archive/empty.md', message: 'provider 503' },
            { kind: 'tick', path: 'archive/empty.md', remaining: 0 },
          ],
        },
        { delayMs: 200, events: [{ kind: 'complete', remaining: 0 }] },
      ]}
    />
  ),
};

export const InteractiveDirtyThenReindex: Story = {
  render: () => (
    <ScriptedHarness
      initialHasIndex={true}
      script={[
        { delayMs: 0, events: [{ kind: 'dirty', count: 1 }] },
        { delayMs: 800, events: [{ kind: 'dirty', count: 3 }] },
        { delayMs: 800, events: [{ kind: 'dirty', count: 7 }] },
      ]}
    />
  ),
};
