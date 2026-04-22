// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { IndexEmptyStateCta, type IndexStatusSource } from '@/ui/chat/IndexEmptyStateCta';
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

describe('IndexEmptyStateCta', () => {
  it('returns null when an index already exists', () => {
    const { source } = makeSource(true);
    const { container } = render(<IndexEmptyStateCta source={source} />);
    expect(container.querySelector('[data-region="index-empty-cta"]')).toBeNull();
  });

  it('renders the prompt + Index vault button when no index exists', () => {
    const { source } = makeSource(false);
    const { container } = render(<IndexEmptyStateCta source={source} />);
    expect(container.querySelector('[data-region="index-empty-cta"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="index-empty-cta-button"]')).not.toBeNull();
    expect(container.textContent).toContain("Your vault isn't indexed yet");
  });

  it('calls onIndexVault on button click', () => {
    const { source } = makeSource(false);
    const fn = vi.fn();
    const { container } = render(<IndexEmptyStateCta source={source} onIndexVault={fn} />);
    fireEvent.click(container.querySelector('[data-slot="index-empty-cta-button"]')!);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('unmounts on drain.complete even if hasIndex still reports false', async () => {
    const { source } = makeSource(false);
    const drain = makeDrainSubscribe();
    const { container } = render(
      <IndexEmptyStateCta source={source} drainSubscribe={drain.subscribe} />,
    );
    expect(container.querySelector('[data-region="index-empty-cta"]')).not.toBeNull();
    await act(async () => {
      drain.emit({ kind: 'complete', remaining: 0 });
    });
    expect(container.querySelector('[data-region="index-empty-cta"]')).toBeNull();
  });

  it('re-renders when hasIndex changes from true → false', async () => {
    const { source, setHasIndex } = makeSource(true);
    const { container } = render(<IndexEmptyStateCta source={source} />);
    expect(container.querySelector('[data-region="index-empty-cta"]')).toBeNull();
    await act(async () => {
      setHasIndex(false);
    });
    expect(container.querySelector('[data-region="index-empty-cta"]')).not.toBeNull();
  });
});
