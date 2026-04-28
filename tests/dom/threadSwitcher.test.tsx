// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThreadSwitcher, type ThreadsUiSource } from '@/ui/chat/ThreadSwitcher';
import type { ThreadsSnapshot, ThreadSummary } from '@/storage/threadsStore';

afterEach(cleanup);

function makeSource(initial: ThreadsSnapshot): {
  source: ThreadsUiSource;
  emit: (next: ThreadsSnapshot) => void;
  calls: {
    create: number;
    switch: string[];
    rename: Array<[string, string]>;
    del: string[];
  };
} {
  let snap = initial;
  const listeners = new Set<() => void>();
  const calls = {
    create: 0,
    switch: [] as string[],
    rename: [] as Array<[string, string]>,
    del: [] as string[],
  };
  const source: ThreadsUiSource = {
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getSnapshot: () => snap,
    create: async () => {
      calls.create += 1;
      return 'new-id';
    },
    switch: async (id) => {
      calls.switch.push(id);
    },
    rename: async (id, title) => {
      calls.rename.push([id, title]);
    },
    delete: async (id) => {
      calls.del.push(id);
    },
  };
  const emit = (next: ThreadsSnapshot): void => {
    snap = next;
    for (const l of listeners) l();
  };
  return { source, emit, calls };
}

function summary(id: string, title: string, messageCount = 0): ThreadSummary {
  return { id, title, updatedAt: '2026-04-23T00:00:00.000Z', messageCount };
}

describe('ThreadSwitcher', () => {
  it('shows active thread title in the button', () => {
    const { source } = makeSource({
      activeId: 'a',
      summaries: [summary('a', 'Alpha'), summary('b', 'Beta')],
    });
    render(<ThreadSwitcher source={source} />);
    expect(screen.getByRole('button', { name: /Active thread: Alpha/ })).toBeTruthy();
  });

  it('falls back to "New thread" label when no active thread', () => {
    const { source } = makeSource({ activeId: null, summaries: [] });
    render(<ThreadSwitcher source={source} />);
    expect(screen.getByRole('button', { name: /Active thread: New thread/ })).toBeTruthy();
  });

  it('opens the list on click and renders an item per summary', () => {
    const { source } = makeSource({
      activeId: 'a',
      summaries: [summary('a', 'Alpha'), summary('b', 'Beta')],
    });
    render(<ThreadSwitcher source={source} />);
    fireEvent.click(screen.getByRole('button', { name: /Active thread/ }));
    const listbox = screen.getByRole('listbox');
    expect(listbox.getAttribute('aria-label')).toBe('Chat threads');
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('clicking a non-active thread calls source.switch', () => {
    const { source, calls } = makeSource({
      activeId: 'a',
      summaries: [summary('a', 'Alpha'), summary('b', 'Beta')],
    });
    render(<ThreadSwitcher source={source} />);
    fireEvent.click(screen.getByRole('button', { name: /Active thread/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
    expect(calls.switch).toEqual(['b']);
  });

  it('"+" button calls source.create', () => {
    const { source, calls } = makeSource({
      activeId: 'a',
      summaries: [summary('a', 'Alpha')],
    });
    render(<ThreadSwitcher source={source} />);
    fireEvent.click(screen.getByRole('button', { name: 'New thread' }));
    expect(calls.create).toBe(1);
  });

  it('delete button calls source.delete', () => {
    const { source, calls } = makeSource({
      activeId: 'a',
      summaries: [summary('a', 'Alpha'), summary('b', 'Beta')],
    });
    render(<ThreadSwitcher source={source} />);
    fireEvent.click(screen.getByRole('button', { name: /Active thread/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Beta' }));
    expect(calls.del).toEqual(['b']);
  });

  it('double-click on item enters rename mode; Enter commits via source.rename', () => {
    const { source, calls } = makeSource({
      activeId: 'a',
      summaries: [summary('a', 'Alpha')],
    });
    render(<ThreadSwitcher source={source} />);
    fireEvent.click(screen.getByRole('button', { name: /Active thread/ }));
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Alpha' }));
    const input = screen.getByDisplayValue('Alpha') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(calls.rename).toEqual([['a', 'Renamed']]);
  });

  it('reflects snapshot updates via subscribe', () => {
    const { source, emit } = makeSource({
      activeId: 'a',
      summaries: [summary('a', 'Alpha')],
    });
    render(<ThreadSwitcher source={source} />);
    expect(screen.getByRole('button', { name: /Active thread: Alpha/ })).toBeTruthy();
    act(() => {
      emit({ activeId: 'b', summaries: [summary('a', 'Alpha'), summary('b', 'Beta')] });
    });
    expect(screen.getByRole('button', { name: /Active thread: Beta/ })).toBeTruthy();
  });

  it('Escape closes the list', () => {
    const { source } = makeSource({
      activeId: 'a',
      summaries: [summary('a', 'Alpha')],
    });
    render(<ThreadSwitcher source={source} />);
    fireEvent.click(screen.getByRole('button', { name: /Active thread/ }));
    expect(screen.queryByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('does not call switch when clicking the already-active row', () => {
    const { source, calls } = makeSource({
      activeId: 'a',
      summaries: [summary('a', 'Alpha')],
    });
    render(<ThreadSwitcher source={source} />);
    fireEvent.click(screen.getByRole('button', { name: /Active thread/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Alpha' }));
    expect(calls.switch).toEqual([]);
  });
});
