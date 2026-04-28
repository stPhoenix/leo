import { describe, expect, it, vi } from 'vitest';
import { EditLockController } from '@/editor/editLock';
import { HighlightController } from '@/editor/highlights';
import { withLock } from '@/editor/withLock';

describe('EditLockController', () => {
  it('acquires and releases, notifying listeners with symmetry', () => {
    const c = new EditLockController();
    const observed: Array<'null' | 'range'> = [];
    c.subscribe((r) => observed.push(r === null ? 'null' : 'range'));
    c.acquire({ from: 10, to: 20 });
    expect(c.isHeld()).toBe(true);
    c.release();
    expect(c.isHeld()).toBe(false);
    expect(observed).toEqual(['range', 'null']);
  });

  it('throws when acquiring a second lock while one is held', () => {
    const c = new EditLockController();
    c.acquire({ from: 0, to: 5 });
    expect(() => c.acquire({ from: 5, to: 10 })).toThrow(/already held/);
  });

  it('intersects() returns true for overlapping ranges and false for disjoint', () => {
    const c = new EditLockController();
    c.acquire({ from: 10, to: 20 });
    expect(c.intersects(5, 15)).toBe(true);
    expect(c.intersects(15, 25)).toBe(true);
    expect(c.intersects(10, 20)).toBe(true);
    expect(c.intersects(0, 5)).toBe(false);
    expect(c.intersects(20, 25)).toBe(false);
  });

  it('recordBlocked fires the onBlockedKeystroke callback when locked', () => {
    const onBlocked = vi.fn();
    const c = new EditLockController({ onBlockedKeystroke: onBlocked });
    c.acquire({ from: 10, to: 20 });
    c.recordBlocked(12, 15);
    expect(onBlocked).toHaveBeenCalledWith({ from: 10, to: 20 });
  });
});

describe('HighlightController', () => {
  it('adds ranges, notifies listeners, and expires via timer', () => {
    vi.useFakeTimers();
    try {
      const h = new HighlightController({ durationMs: 3000 });
      const seen: number[] = [];
      h.subscribe((r) => seen.push(r.length));
      const id = h.highlight(10, 20);
      expect(h.list()).toHaveLength(1);
      vi.advanceTimersByTime(3000);
      expect(h.list()).toHaveLength(0);
      expect(seen[0]).toBe(1);
      expect(seen[seen.length - 1]).toBe(0);
      expect(id).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('dispose clears all timers and active ranges with no further listener fires', () => {
    vi.useFakeTimers();
    try {
      const h = new HighlightController({ durationMs: 1000 });
      h.highlight(0, 5);
      h.highlight(10, 15);
      h.dispose();
      expect(h.list()).toHaveLength(0);
      vi.advanceTimersByTime(5000);
      expect(h.list()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clear(id) removes a specific range early and cancels its timer', () => {
    vi.useFakeTimers();
    try {
      const h = new HighlightController({ durationMs: 3000 });
      const a = h.highlight(0, 5);
      const b = h.highlight(10, 15);
      h.clear(a);
      expect(h.list().map((r) => r.id)).toEqual([b]);
      vi.advanceTimersByTime(3000);
      expect(h.list()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('withLock orchestrator', () => {
  it('acquires, applies successfully, schedules highlight, releases on success', async () => {
    const lock = new EditLockController();
    const h = new HighlightController({ durationMs: 10 });
    const ac = new AbortController();
    const apply = vi.fn(async () => ({ ok: true as const }));
    const result = await withLock({ lock, highlights: h }, { from: 5, to: 10 }, ac.signal, apply);
    expect(result.ok).toBe(true);
    expect(apply).toHaveBeenCalled();
    expect(lock.isHeld()).toBe(false);
    expect(h.list()).toHaveLength(1);
  });

  it('releases the lock on applier ok=false (no highlight scheduled)', async () => {
    const lock = new EditLockController();
    const h = new HighlightController({ durationMs: 10 });
    const ac = new AbortController();
    const result = await withLock(
      { lock, highlights: h },
      { from: 0, to: 4 },
      ac.signal,
      async () => ({ ok: false }),
    );
    expect(result.ok).toBe(false);
    expect(lock.isHeld()).toBe(false);
    expect(h.list()).toHaveLength(0);
  });

  it('releases the lock when the applier throws (atomic failure)', async () => {
    const lock = new EditLockController();
    const h = new HighlightController({ durationMs: 10 });
    const ac = new AbortController();
    const result = await withLock(
      { lock, highlights: h },
      { from: 0, to: 4 },
      ac.signal,
      async () => {
        throw new Error('boom');
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('threw');
    expect(lock.isHeld()).toBe(false);
    expect(h.list()).toHaveLength(0);
  });

  it('releases the lock when the signal is aborted before apply', async () => {
    const lock = new EditLockController();
    const h = new HighlightController({ durationMs: 10 });
    const ac = new AbortController();
    ac.abort();
    const apply = vi.fn(async () => ({ ok: true as const }));
    const result = await withLock({ lock, highlights: h }, { from: 0, to: 4 }, ac.signal, apply);
    expect(result.ok).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(lock.isHeld()).toBe(false);
  });

  it('releases the lock when the signal is aborted mid-apply (cancel)', async () => {
    const lock = new EditLockController();
    const h = new HighlightController({ durationMs: 10 });
    const ac = new AbortController();
    const result = await withLock(
      { lock, highlights: h },
      { from: 0, to: 4 },
      ac.signal,
      async () => {
        ac.abort();
        return { ok: true };
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('cancelled');
    expect(lock.isHeld()).toBe(false);
    expect(h.list()).toHaveLength(0);
  });
});
