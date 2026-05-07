import { describe, expect, it } from 'vitest';
import { CanvasMutex } from '@/agent/canvas/mutex';

describe('CanvasMutex', () => {
  it('blocks second acquire on same path with busy + active info', () => {
    const m = new CanvasMutex();
    const a = m.acquire('a/b.canvas', 'r1', 'create');
    expect(a.ok).toBe(true);
    const b = m.acquire('a/b.canvas', 'r2', 'content_edit');
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(b.busy.activeRunId).toBe('r1');
    expect(b.busy.activeOp).toBe('create');
  });

  it('distinct paths run in parallel', () => {
    const m = new CanvasMutex();
    const a = m.acquire('a.canvas', 'r1', 'create');
    const b = m.acquire('b.canvas', 'r2', 'create');
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });

  it('release frees the slot for subsequent acquire', () => {
    const m = new CanvasMutex();
    const a = m.acquire('a.canvas', 'r1', 'create');
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    a.release();
    const b = m.acquire('a.canvas', 'r2', 'content_edit');
    expect(b.ok).toBe(true);
  });

  it('release is idempotent and does not delete an unrelated subsequent holder', () => {
    const m = new CanvasMutex();
    const a = m.acquire('a.canvas', 'r1', 'create');
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    a.release();
    const b = m.acquire('a.canvas', 'r2', 'content_edit');
    expect(b.ok).toBe(true);
    a.release();
    expect(m.active('a.canvas')).toEqual({ path: 'a.canvas', op: 'content_edit', runId: 'r2' });
  });

  it('active returns snapshot or null', () => {
    const m = new CanvasMutex();
    expect(m.active('x.canvas')).toBeNull();
    const a = m.acquire('x.canvas', 'r1', 'layout_edit');
    expect(m.active('x.canvas')).toEqual({ path: 'x.canvas', op: 'layout_edit', runId: 'r1' });
    if (a.ok) a.release();
    expect(m.active('x.canvas')).toBeNull();
  });

  it('activeAll returns alphabetical snapshot', () => {
    const m = new CanvasMutex();
    m.acquire('z.canvas', 'rZ', 'create');
    m.acquire('a.canvas', 'rA', 'content_edit');
    m.acquire('m.canvas', 'rM', 'layout_edit');
    const all = m.activeAll();
    expect(all.map((s) => s.path)).toEqual(['a.canvas', 'm.canvas', 'z.canvas']);
  });
});
