import { describe, expect, it } from 'vitest';
import { SlotManager } from '@/agent/externalAgent/slotManager';

describe('SlotManager', () => {
  it('first acquire returns handle, second on same thread returns busy with active runId', () => {
    const m = new SlotManager();
    const a = m.acquire('t1', 'run-1');
    expect(a.busy).toBe(false);
    const b = m.acquire('t1', 'run-2');
    expect(b.busy).toBe(true);
    if (b.busy) expect(b.activeRunId).toBe('run-1');
  });

  it('different threads each get a slot', () => {
    const m = new SlotManager();
    const a = m.acquire('t1', 'r1');
    const b = m.acquire('t2', 'r2');
    expect(a.busy).toBe(false);
    expect(b.busy).toBe(false);
    expect(m.size()).toBe(2);
  });

  it('release frees the slot for the same thread', () => {
    const m = new SlotManager();
    const first = m.acquire('t1', 'r1');
    if (first.busy) throw new Error('expected acquired');
    first.handle.release();
    const second = m.acquire('t1', 'r2');
    expect(second.busy).toBe(false);
  });

  it('release is idempotent', () => {
    const m = new SlotManager();
    const r = m.acquire('t1', 'r1');
    if (r.busy) throw new Error('acquire failed');
    r.handle.release();
    r.handle.release();
    expect(m.size()).toBe(0);
  });

  it('active(threadId) reports current runId or null', () => {
    const m = new SlotManager();
    expect(m.active('t1')).toBeNull();
    const r = m.acquire('t1', 'r1');
    expect(m.active('t1')).toBe('r1');
    if (!r.busy) r.handle.release();
    expect(m.active('t1')).toBeNull();
  });
});
