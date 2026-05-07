import { describe, expect, it } from 'vitest';
import { ReadFileStateStore } from '@/tools/builtin/readFileState';

describe('ReadFileStateStore', () => {
  it('returns the same entry on get when set', () => {
    const store = new ReadFileStateStore();
    store.set('t', 'a.md', {
      content: 'hi',
      mtimeMs: 100,
      offset: undefined,
      limit: undefined,
      isPartialView: false,
    });
    const got = store.get('t', 'a.md');
    expect(got?.content).toBe('hi');
    expect(got?.mtimeMs).toBe(100);
  });

  it('matches returns entry only when mtime + offset + limit align', () => {
    const store = new ReadFileStateStore();
    store.set('t', 'a.md', {
      content: 'x',
      mtimeMs: 100,
      offset: 1,
      limit: 5,
      isPartialView: false,
    });
    expect(store.matches('t', 'a.md', 100, 1, 5)).toBeDefined();
    expect(store.matches('t', 'a.md', 200, 1, 5)).toBeUndefined();
    expect(store.matches('t', 'a.md', 100, 2, 5)).toBeUndefined();
    expect(store.matches('t', 'a.md', 100, 1, 6)).toBeUndefined();
    expect(store.matches('t', 'missing.md', 100, 1, 5)).toBeUndefined();
  });

  it('matches skips entries flagged isPartialView=true', () => {
    const store = new ReadFileStateStore();
    store.set('t', 'a.md', {
      content: 'x',
      mtimeMs: 100,
      offset: undefined,
      limit: undefined,
      isPartialView: true,
    });
    expect(store.matches('t', 'a.md', 100, undefined, undefined)).toBeUndefined();
  });

  it('invalidate removes a single entry, clear empties all', () => {
    const store = new ReadFileStateStore();
    store.set('t', 'a.md', {
      content: 'a',
      mtimeMs: 1,
      offset: undefined,
      limit: undefined,
      isPartialView: false,
    });
    store.set('t', 'b.md', {
      content: 'b',
      mtimeMs: 2,
      offset: undefined,
      limit: undefined,
      isPartialView: false,
    });
    store.invalidate('t', 'a.md');
    expect(store.get('t', 'a.md')).toBeUndefined();
    expect(store.get('t', 'b.md')?.content).toBe('b');
    store.clear();
    expect(store.get('t', 'b.md')).toBeUndefined();
  });

  it('isolates entries per thread — same path in different threads is independent', () => {
    const store = new ReadFileStateStore();
    store.set('A', 'a.md', {
      content: 'from-A',
      mtimeMs: 100,
      offset: undefined,
      limit: undefined,
      isPartialView: false,
    });
    expect(store.get('B', 'a.md')).toBeUndefined();
    expect(store.matches('B', 'a.md', 100, undefined, undefined)).toBeUndefined();
    expect(store.get('A', 'a.md')?.content).toBe('from-A');
  });

  it('clearThread drops only the named thread, leaves others intact', () => {
    const store = new ReadFileStateStore();
    const entry = {
      content: 'x',
      mtimeMs: 1,
      offset: undefined,
      limit: undefined,
      isPartialView: false,
    };
    store.set('A', 'a.md', entry);
    store.set('B', 'a.md', entry);
    store.clearThread('A');
    expect(store.get('A', 'a.md')).toBeUndefined();
    expect(store.get('B', 'a.md')?.content).toBe('x');
  });
});
