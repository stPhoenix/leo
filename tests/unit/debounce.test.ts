import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { debounce } from '@/util/debounce';

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('invokes only once after trailing wait', () => {
    const spy = vi.fn();
    const d = debounce(spy, 300);
    d();
    d();
    d();
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(299);
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('collapses bursts to ≤1 invocation per wait window', () => {
    const spy = vi.fn();
    const d = debounce(spy, 300);
    for (let i = 0; i < 50; i += 1) {
      d();
      vi.advanceTimersByTime(5);
    }
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('delivers the final arguments of a burst', () => {
    const spy = vi.fn<[number], void>();
    const d = debounce(spy, 100);
    d(1);
    d(2);
    d(3);
    vi.advanceTimersByTime(100);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(3);
  });

  it('cancel clears pending call', () => {
    const spy = vi.fn();
    const d = debounce(spy, 100);
    d();
    d.cancel();
    vi.advanceTimersByTime(500);
    expect(spy).not.toHaveBeenCalled();
    expect(d.pending()).toBe(false);
  });

  it('flush forces immediate call', () => {
    const spy = vi.fn<[string], void>();
    const d = debounce(spy, 100);
    d('a');
    expect(d.pending()).toBe(true);
    d.flush();
    expect(spy).toHaveBeenCalledWith('a');
    expect(d.pending()).toBe(false);
  });

  it('flush is a no-op when nothing pending', () => {
    const spy = vi.fn();
    const d = debounce(spy, 100);
    d.flush();
    expect(spy).not.toHaveBeenCalled();
  });
});
