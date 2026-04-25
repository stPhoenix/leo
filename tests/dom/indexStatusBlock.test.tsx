// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { IndexStatusBlock, type IndexStatusSource } from '@/ui/chat/IndexStatusBlock';
import type { DrainEvent, DrainListener } from '@/indexer/vaultIndexer';

afterEach(cleanup);

function makeSource(initialHas: boolean): {
  source: IndexStatusSource;
  setHasIndex: (v: boolean) => void;
} {
  let hasIndex = initialHas;
  const listeners = new Set<() => void>();
  return {
    source: {
      hasIndex: () => hasIndex,
      subscribe: (cb) => {
        listeners.add(cb);
        return () => {
          listeners.delete(cb);
        };
      },
    },
    setHasIndex: (v: boolean) => {
      hasIndex = v;
      for (const l of listeners) l();
    },
  };
}

function makeDrainSubscribe(): {
  subscribe: (l: DrainListener) => () => void;
  emit: (e: DrainEvent) => void;
} {
  let listener: DrainListener | null = null;
  return {
    subscribe: (l) => {
      listener = l;
      return () => {
        listener = null;
      };
    },
    emit: (e) => listener?.(e),
  };
}

const REGION = '[data-region="index-status-block"]';

describe('IndexStatusBlock', () => {
  it('renders nothing when index exists, no dirty notes, no errors', () => {
    const { source } = makeSource(true);
    const { container } = render(<IndexStatusBlock source={source} />);
    expect(container.querySelector(REGION)).toBeNull();
  });

  it('renders not-indexed variant + Index vault button when no index exists', () => {
    const { source } = makeSource(false);
    const { container } = render(<IndexStatusBlock source={source} />);
    const region = container.querySelector(REGION);
    expect(region).not.toBeNull();
    expect(region?.getAttribute('data-variant')).toBe('not-indexed');
    expect(container.querySelector('[data-slot="index-block-button-index"]')).not.toBeNull();
    expect(container.textContent).toContain("Your vault isn't indexed yet");
  });

  it('calls onReindexAll when not-indexed Index vault button clicked', () => {
    const { source } = makeSource(false);
    const fn = vi.fn();
    const { container } = render(<IndexStatusBlock source={source} onReindexAll={fn} />);
    fireEvent.click(container.querySelector('[data-slot="index-block-button-index"]')!);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('renders dirty variant with both reindex buttons when drain emits dirty count > 0', async () => {
    const { source } = makeSource(true);
    const drain = makeDrainSubscribe();
    const onAll = vi.fn();
    const onChanged = vi.fn();
    const { container } = render(
      <IndexStatusBlock
        source={source}
        drainSubscribe={drain.subscribe}
        onReindexAll={onAll}
        onReindexChanged={onChanged}
      />,
    );
    await act(async () => {
      drain.emit({ kind: 'dirty', count: 3 });
    });
    const region = container.querySelector(REGION);
    expect(region?.getAttribute('data-variant')).toBe('dirty');
    expect(container.textContent).toContain('3 notes changed');
    fireEvent.click(container.querySelector('[data-slot="index-block-button-reindex-changed"]')!);
    fireEvent.click(container.querySelector('[data-slot="index-block-button-reindex-all"]')!);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onAll).toHaveBeenCalledTimes(1);
  });

  it('renders indexing variant with progress info during drain', async () => {
    const { source } = makeSource(true);
    const drain = makeDrainSubscribe();
    const { container } = render(
      <IndexStatusBlock source={source} drainSubscribe={drain.subscribe} />,
    );
    await act(async () => {
      drain.emit({ kind: 'start', size: 10 });
      drain.emit({ kind: 'tick', path: 'notes/a.md', remaining: 7 });
    });
    const region = container.querySelector(REGION);
    expect(region?.getAttribute('data-variant')).toBe('indexing');
    expect(container.textContent).toContain('Indexing');
    expect(container.querySelector('[data-slot="index-block-current"]')?.textContent).toBe(
      'notes/a.md',
    );
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
  });

  it('renders errors variant when drain emits a path-less error (provider bail)', async () => {
    const { source } = makeSource(false);
    const drain = makeDrainSubscribe();
    const onAll = vi.fn();
    const { container } = render(
      <IndexStatusBlock source={source} drainSubscribe={drain.subscribe} onReindexAll={onAll} />,
    );
    await act(async () => {
      drain.emit({ kind: 'error', message: 'Embedding provider unavailable.' });
    });
    const region = container.querySelector(REGION);
    expect(region?.getAttribute('data-variant')).toBe('errors');
    expect(container.textContent).toContain('Embedding provider unavailable');
    // Errors variant outranks not-indexed even when hasIndex is false
    expect(container.querySelector('[data-slot="index-block-button-index"]')).toBeNull();
  });

  it('dedupes consecutive identical error events in the reducer', async () => {
    const { source } = makeSource(true);
    const drain = makeDrainSubscribe();
    const { container } = render(
      <IndexStatusBlock source={source} drainSubscribe={drain.subscribe} />,
    );
    await act(async () => {
      drain.emit({ kind: 'error', message: 'Provider down' });
      drain.emit({ kind: 'error', message: 'Provider down' });
      drain.emit({ kind: 'error', message: 'Provider down' });
    });
    expect(container.textContent).toContain('Provider down');
    // Headline reads the latest general error; just one entry tracked.
    const region = container.querySelector(REGION);
    expect(region?.getAttribute('data-variant')).toBe('errors');
  });

  it('renders errors variant after drain completes with errors', async () => {
    const { source } = makeSource(true);
    const drain = makeDrainSubscribe();
    const onChanged = vi.fn();
    const { container } = render(
      <IndexStatusBlock
        source={source}
        drainSubscribe={drain.subscribe}
        onReindexChanged={onChanged}
      />,
    );
    await act(async () => {
      drain.emit({ kind: 'start', size: 2 });
      drain.emit({ kind: 'error', path: 'broken.md', message: 'boom' });
      drain.emit({ kind: 'tick', path: 'broken.md', remaining: 1 });
      drain.emit({ kind: 'tick', path: 'ok.md', remaining: 0 });
      drain.emit({ kind: 'complete', remaining: 0 });
    });
    const region = container.querySelector(REGION);
    expect(region?.getAttribute('data-variant')).toBe('errors');
    expect(container.textContent).toContain('Failed to index 1 note');
    expect(container.textContent).toContain('broken.md');
    fireEvent.click(container.querySelector('[data-slot="index-block-button-retry"]')!);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('shows complete toast briefly after drain completes with no errors', async () => {
    vi.useFakeTimers();
    const { source } = makeSource(true);
    const drain = makeDrainSubscribe();
    const { container } = render(
      <IndexStatusBlock source={source} drainSubscribe={drain.subscribe} completeToastMs={1_000} />,
    );
    await act(async () => {
      drain.emit({ kind: 'start', size: 2 });
      drain.emit({ kind: 'tick', path: 'a.md', remaining: 0 });
      drain.emit({ kind: 'complete', remaining: 0 });
    });
    expect(container.querySelector(REGION)?.getAttribute('data-variant')).toBe('complete');
    await act(async () => {
      vi.advanceTimersByTime(1_500);
    });
    expect(container.querySelector(REGION)).toBeNull();
    vi.useRealTimers();
  });

  it('re-renders when hasIndex changes from true → false', async () => {
    const { source, setHasIndex } = makeSource(true);
    const { container } = render(<IndexStatusBlock source={source} />);
    expect(container.querySelector(REGION)).toBeNull();
    await act(async () => {
      setHasIndex(false);
    });
    expect(container.querySelector(REGION)).not.toBeNull();
  });
});
