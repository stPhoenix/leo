import { describe, expect, it } from 'vitest';
import { WikiMutex, withWikiMutex } from '@/agent/wiki/mutex';

describe('WikiMutex', () => {
  it('acquire returns ok+release when no holder', () => {
    const m = new WikiMutex();
    const r = m.acquire('ingest', 'run-1');
    expect(r.ok).toBe(true);
    expect(m.active()).toEqual({ kind: 'busy', op: 'ingest', runId: 'run-1' });
    if (r.ok) r.release();
    expect(m.active()).toEqual({ kind: 'idle' });
  });

  it('second acquire while held returns busy with active runId+op', () => {
    const m = new WikiMutex();
    const first = m.acquire('ingest', 'run-1');
    expect(first.ok).toBe(true);
    const second = m.acquire('lint', 'run-2');
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toBe('busy');
      expect(second.activeRunId).toBe('run-1');
      expect(second.activeOp).toBe('ingest');
    }
  });

  it('release is idempotent', () => {
    const m = new WikiMutex();
    const r = m.acquire('lint', 'run-x');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    r.release();
    r.release();
    expect(m.active()).toEqual({ kind: 'idle' });
    // After release, next acquire succeeds
    const r2 = m.acquire('ingest', 'run-y');
    expect(r2.ok).toBe(true);
  });

  it('withWikiMutex releases on body throw', async () => {
    const m = new WikiMutex();
    let caught: unknown;
    try {
      await withWikiMutex({ mutex: m, op: 'ingest', runId: 'r1' }, async () => {
        throw new Error('boom');
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as Error).message).toBe('boom');
    expect(m.active()).toEqual({ kind: 'idle' });
  });

  it('withWikiMutex releases on AbortSignal abort before body runs', async () => {
    const m = new WikiMutex();
    const ac = new AbortController();
    ac.abort();
    let bodyRan = false;
    let caught: unknown;
    try {
      await withWikiMutex({ mutex: m, op: 'ingest', runId: 'r1', signal: ac.signal }, async () => {
        bodyRan = true;
        return 1;
      });
    } catch (err) {
      caught = err;
    }
    expect(bodyRan).toBe(false);
    expect((caught as DOMException).name).toBe('AbortError');
    expect(m.active()).toEqual({ kind: 'idle' });
  });

  it('withWikiMutex returns busy result without invoking body when held', async () => {
    const m = new WikiMutex();
    const held = m.acquire('ingest', 'r-held');
    expect(held.ok).toBe(true);

    let bodyRan = false;
    const result = await withWikiMutex({ mutex: m, op: 'lint', runId: 'r-new' }, async () => {
      bodyRan = true;
      return 42;
    });
    expect(bodyRan).toBe(false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('busy');
      expect(result.activeRunId).toBe('r-held');
    }
  });
});
