import { describe, expect, it } from 'vitest';
import { IndexerStatusTap } from '@/indexer/indexerStatusTap';
import type { DrainEvent, DrainListener } from '@/indexer/vaultIndexer';

function makeSubscribe(): {
  subscribe: (l: DrainListener) => () => void;
  emit: (e: DrainEvent) => void;
  isUnsubscribed: () => boolean;
} {
  let listener: DrainListener | null = null;
  let unsubscribed = false;
  return {
    subscribe: (l) => {
      listener = l;
      return () => {
        listener = null;
        unsubscribed = true;
      };
    },
    emit: (e) => listener?.(e),
    isUnsubscribed: () => unsubscribed,
  };
}

describe('IndexerStatusTap', () => {
  it('starts in idle phase with zero remaining', () => {
    const sub = makeSubscribe();
    const tap = new IndexerStatusTap({ subscribe: sub.subscribe });
    expect(tap.getLatest()).toEqual({
      phase: 'idle',
      remaining: 0,
      currentPath: null,
      lastError: null,
    });
  });

  it('transitions to draining on start with size as remaining', () => {
    const sub = makeSubscribe();
    const tap = new IndexerStatusTap({ subscribe: sub.subscribe });
    sub.emit({ kind: 'start', size: 12 });
    expect(tap.getLatest()).toEqual({
      phase: 'draining',
      remaining: 12,
      currentPath: null,
      lastError: null,
    });
  });

  it('updates remaining + currentPath on tick events', () => {
    const sub = makeSubscribe();
    const tap = new IndexerStatusTap({ subscribe: sub.subscribe });
    sub.emit({ kind: 'start', size: 12 });
    sub.emit({ kind: 'tick', remaining: 7, path: 'notes/foo.md' });
    expect(tap.getLatest()).toMatchObject({
      phase: 'draining',
      remaining: 7,
      currentPath: 'notes/foo.md',
    });
  });

  it('returns to idle on complete', () => {
    const sub = makeSubscribe();
    const tap = new IndexerStatusTap({ subscribe: sub.subscribe });
    sub.emit({ kind: 'start', size: 1 });
    sub.emit({ kind: 'complete', remaining: 0 });
    expect(tap.getLatest()).toEqual({
      phase: 'idle',
      remaining: 0,
      currentPath: null,
      lastError: null,
    });
  });

  it('marks paused-on-user when error message starts with "Indexer paused"', () => {
    const sub = makeSubscribe();
    const tap = new IndexerStatusTap({ subscribe: sub.subscribe });
    sub.emit({ kind: 'error', message: 'Indexer paused — embedding model changed' });
    const snap = tap.getLatest();
    expect(snap.phase).toBe('paused-on-user');
    expect(snap.lastError).toMatch(/Indexer paused/);
  });

  it('marks errored for other error messages', () => {
    const sub = makeSubscribe();
    const tap = new IndexerStatusTap({ subscribe: sub.subscribe });
    sub.emit({ kind: 'start', size: 4 });
    sub.emit({ kind: 'tick', remaining: 3, path: 'a.md' });
    sub.emit({ kind: 'error', path: 'a.md', message: 'embed-failed' });
    const snap = tap.getLatest();
    expect(snap.phase).toBe('errored');
    expect(snap.lastError).toBe('embed-failed');
    expect(snap.remaining).toBe(3);
    expect(snap.currentPath).toBe('a.md');
  });

  it('ignores dirty events for phase tracking', () => {
    const sub = makeSubscribe();
    const tap = new IndexerStatusTap({ subscribe: sub.subscribe });
    sub.emit({ kind: 'dirty', count: 5 });
    expect(tap.getLatest().phase).toBe('idle');
  });

  it('unsubscribes on dispose; further events are ignored', () => {
    const sub = makeSubscribe();
    const tap = new IndexerStatusTap({ subscribe: sub.subscribe });
    tap.dispose();
    expect(sub.isUnsubscribed()).toBe(true);
    tap.dispose();
    expect(tap.getLatest().phase).toBe('idle');
  });
});
