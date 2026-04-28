// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { IndexerStatusBar } from '@/indexer/indexerStatusBar';
import type { DrainEvent, DrainListener } from '@/indexer/vaultIndexer';

function makeSubscribe(): {
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

function mkHost(): { element: HTMLElement; setIcon: ReturnType<typeof vi.fn> } {
  const element = document.createElement('div');
  return { element, setIcon: vi.fn() };
}

function syncRaf(): {
  raf: (cb: () => void) => number;
  cancel: (h: number) => void;
  flush: () => void;
} {
  const queue: Array<() => void> = [];
  let id = 0;
  return {
    raf: (cb) => {
      queue.push(cb);
      id += 1;
      return id;
    },
    cancel: () => undefined,
    flush: () => {
      const pending = [...queue];
      queue.length = 0;
      for (const fn of pending) fn();
    },
  };
}

describe('IndexerStatusBar', () => {
  it('hides the host element by default (idle state)', () => {
    const sub = makeSubscribe();
    const host = mkHost();
    new IndexerStatusBar({ subscribe: sub.subscribe, host, rafImpl: syncRaf().raf });
    expect(host.element.hidden).toBe(true);
    expect(host.element.getAttribute('role')).toBe('status');
    expect(host.element.getAttribute('aria-live')).toBe('polite');
  });

  it('renders Indexing: <n> files left - <basename> on drain.tick', () => {
    const sub = makeSubscribe();
    const host = mkHost();
    const raf = syncRaf();
    new IndexerStatusBar({ subscribe: sub.subscribe, host, rafImpl: raf.raf, collapseWidthPx: 0 });
    sub.emit({ kind: 'start', size: 5 });
    sub.emit({ kind: 'tick', path: 'folder/note.md', remaining: 4 });
    raf.flush();
    expect(host.element.hidden).toBe(false);
    expect(host.element.textContent).toBe('Indexing: 4 files left - note.md');
  });

  it('collapses to Indexing: <n> when width < collapseWidthPx', () => {
    const sub = makeSubscribe();
    const host = mkHost();
    host.element.getBoundingClientRect = (): DOMRect => ({
      width: 80,
      height: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => '',
    });
    const raf = syncRaf();
    new IndexerStatusBar({
      subscribe: sub.subscribe,
      host,
      rafImpl: raf.raf,
      collapseWidthPx: 140,
    });
    sub.emit({ kind: 'start', size: 5 });
    sub.emit({ kind: 'tick', path: 'folder/note.md', remaining: 4 });
    raf.flush();
    expect(host.element.textContent).toBe('Indexing: 4');
  });

  it('DOM-removes on drain.complete', () => {
    const sub = makeSubscribe();
    const host = mkHost();
    const raf = syncRaf();
    new IndexerStatusBar({ subscribe: sub.subscribe, host, rafImpl: raf.raf, collapseWidthPx: 0 });
    sub.emit({ kind: 'start', size: 2 });
    sub.emit({ kind: 'tick', path: 'a.md', remaining: 1 });
    sub.emit({ kind: 'complete', remaining: 0 });
    raf.flush();
    expect(host.element.hidden).toBe(true);
    expect(host.element.textContent).toBe('');
  });

  it('rAF-throttles multiple ticks into a single paint', () => {
    const sub = makeSubscribe();
    const host = mkHost();
    const pendingCallbacks: Array<() => void> = [];
    let id = 0;
    const rafImpl = (cb: () => void): number => {
      pendingCallbacks.push(cb);
      id += 1;
      return id;
    };
    let paintCount = 0;
    const originalSetter = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'textContent');
    Object.defineProperty(host.element, 'textContent', {
      set(value: string) {
        paintCount += 1;
        originalSetter?.set?.call(host.element, value);
      },
      get() {
        return originalSetter?.get?.call(host.element) ?? '';
      },
    });
    new IndexerStatusBar({ subscribe: sub.subscribe, host, rafImpl, collapseWidthPx: 0 });
    paintCount = 0; // reset after ctor reset
    sub.emit({ kind: 'start', size: 10 });
    sub.emit({ kind: 'tick', path: 'a.md', remaining: 9 });
    sub.emit({ kind: 'tick', path: 'b.md', remaining: 8 });
    sub.emit({ kind: 'tick', path: 'c.md', remaining: 7 });
    expect(pendingCallbacks.length).toBe(1);
    // Flush the single rAF callback
    pendingCallbacks.shift()!();
    expect(paintCount).toBe(1);
  });

  it('dispose unsubscribes and clears the host', () => {
    const sub = makeSubscribe();
    const host = mkHost();
    const raf = syncRaf();
    const bar = new IndexerStatusBar({
      subscribe: sub.subscribe,
      host,
      rafImpl: raf.raf,
      collapseWidthPx: 0,
    });
    sub.emit({ kind: 'start', size: 1 });
    sub.emit({ kind: 'tick', path: 'x.md', remaining: 0 });
    raf.flush();
    bar.dispose();
    expect(host.element.hidden).toBe(true);
    expect(host.element.textContent).toBe('');
    // Event after dispose — should not re-render
    sub.emit({ kind: 'start', size: 5 });
    expect(host.element.hidden).toBe(true);
  });
});
