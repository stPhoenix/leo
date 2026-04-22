import { describe, expect, it, vi } from 'vitest';
import { ConnectionState } from '@/providers/connectionState';

describe('ConnectionState', () => {
  it('starts available', () => {
    const s = new ConnectionState();
    expect(s.current).toBe('available');
    expect(s.isReachable()).toBe(true);
  });

  it('emits transitions only on actual change', () => {
    const s = new ConnectionState();
    const listener = vi.fn();
    s.on(listener);
    s.markReachable();
    s.markUnreachable();
    s.markUnreachable();
    s.markReachable();
    expect(listener.mock.calls.map((c) => c[0])).toEqual(['unreachable', 'available']);
  });

  it('unsubscribes when returned dispose called', () => {
    const s = new ConnectionState();
    const listener = vi.fn();
    const off = s.on(listener);
    off();
    s.markUnreachable();
    expect(listener).not.toHaveBeenCalled();
  });
});
