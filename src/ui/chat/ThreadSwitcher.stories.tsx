import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, userEvent, within } from 'storybook/test';
import { ThreadSwitcher, type ThreadsUiSource } from './ThreadSwitcher';
import type { ThreadsSnapshot, ThreadSummary } from '@/storage/threadsStore';

interface StatefulSource extends ThreadsUiSource {
  readonly create: ReturnType<typeof fn>;
  readonly switch: ReturnType<typeof fn>;
  readonly rename: ReturnType<typeof fn>;
  readonly delete: ReturnType<typeof fn>;
}

function makeStatefulSource(
  initial: ThreadsSnapshot,
  options: { idGenerator?: () => string } = {},
): StatefulSource {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const l of listeners) l();
  };
  const idGen =
    options.idGenerator ?? ((): string => `t-${Math.random().toString(36).slice(2, 10)}`);

  const create = fn(async (): Promise<string> => {
    const id = idGen();
    const now = new Date().toISOString();
    const fresh: ThreadSummary = { id, title: id, updatedAt: now, messageCount: 0 };
    snapshot = { activeId: id, summaries: [fresh, ...snapshot.summaries] };
    notify();
    return id;
  }).mockName('create');

  const switchTo = fn(async (id: string): Promise<void> => {
    snapshot = { ...snapshot, activeId: id };
    notify();
  }).mockName('switch');

  const rename = fn(async (id: string, title: string): Promise<void> => {
    snapshot = {
      ...snapshot,
      summaries: snapshot.summaries.map((s) => (s.id === id ? { ...s, title } : s)),
    };
    notify();
  }).mockName('rename');

  const del = fn(async (id: string): Promise<void> => {
    const remaining = snapshot.summaries.filter((s) => s.id !== id);
    const nextActive = snapshot.activeId === id ? (remaining[0]?.id ?? null) : snapshot.activeId;
    snapshot = { activeId: nextActive, summaries: remaining };
    notify();
  }).mockName('delete');

  return {
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getSnapshot: () => snapshot,
    create,
    switch: switchTo,
    rename,
    delete: del,
  };
}

const populatedSnapshot: ThreadsSnapshot = {
  activeId: 't-alpha',
  summaries: [
    {
      id: 't-alpha',
      title: 'Obsidian plugin design',
      updatedAt: '2026-04-24T09:10:00Z',
      messageCount: 12,
    },
    {
      id: 't-bravo',
      title: 'Q2 roadmap brainstorm',
      updatedAt: '2026-04-23T16:40:00Z',
      messageCount: 8,
    },
  ],
};

const meta: Meta<typeof ThreadSwitcher> = {
  title: 'Chat/ThreadSwitcher',
  component: ThreadSwitcher,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div
        style={{
          width: 360,
          padding: 12,
          background: 'var(--background-primary)',
          color: 'var(--text-normal)',
          fontFamily: 'var(--font-interface)',
        }}
      >
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof ThreadSwitcher>;

export const Default: Story = {
  args: { source: makeStatefulSource(populatedSnapshot) },
};

export const Empty: Story = {
  args: { source: makeStatefulSource({ activeId: null, summaries: [] }) },
};

export const ListOpen: Story = {
  args: { source: makeStatefulSource(populatedSnapshot) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await canvas.findByRole('button', { name: /Active thread/ });
    await userEvent.click(trigger);
  },
};

export const CreateNewThread: Story = {
  args: {
    source: makeStatefulSource(populatedSnapshot, {
      idGenerator: () => 't-fresh-2026-04-25',
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const newBtn = await canvas.findByRole('button', { name: 'New thread' });
    await userEvent.click(newBtn);
    const trigger = await canvas.findByRole('button', { name: /Active thread/ });
    await userEvent.click(trigger);
  },
};

export const CreateFromEmpty: Story = {
  args: {
    source: makeStatefulSource(
      { activeId: null, summaries: [] },
      { idGenerator: () => 't-first-session' },
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const newBtn = await canvas.findByRole('button', { name: 'New thread' });
    await userEvent.click(newBtn);
  },
};

export const RenameActiveThread: Story = {
  args: { source: makeStatefulSource(populatedSnapshot) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: /Active thread/ }));
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Rename Obsidian plugin design' }),
    );
    const input = (await canvas.findByDisplayValue('Obsidian plugin design')) as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, 'Renamed via Storybook{Enter}');
  },
};

export const RenameInProgress: Story = {
  args: { source: makeStatefulSource(populatedSnapshot) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: /Active thread/ }));
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Rename Q2 roadmap brainstorm' }),
    );
  },
};
