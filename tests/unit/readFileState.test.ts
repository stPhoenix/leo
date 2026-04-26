import { describe, expect, it } from 'vitest';
import { ReadFileStateStore } from '@/tools/builtin/readFileState';

describe('ReadFileStateStore', () => {
  it('returns the same entry on get when set', () => {
    const store = new ReadFileStateStore();
    store.set('a.md', {
      content: 'hi',
      mtimeMs: 100,
      offset: undefined,
      limit: undefined,
      isPartialView: false,
    });
    const got = store.get('a.md');
    expect(got?.content).toBe('hi');
    expect(got?.mtimeMs).toBe(100);
  });

  it('matches returns entry only when mtime + offset + limit align', () => {
    const store = new ReadFileStateStore();
    store.set('a.md', {
      content: 'x',
      mtimeMs: 100,
      offset: 1,
      limit: 5,
      isPartialView: false,
    });
    expect(store.matches('a.md', 100, 1, 5)).toBeDefined();
    expect(store.matches('a.md', 200, 1, 5)).toBeUndefined();
    expect(store.matches('a.md', 100, 2, 5)).toBeUndefined();
    expect(store.matches('a.md', 100, 1, 6)).toBeUndefined();
    expect(store.matches('missing.md', 100, 1, 5)).toBeUndefined();
  });

  it('matches skips entries flagged isPartialView=true', () => {
    const store = new ReadFileStateStore();
    store.set('a.md', {
      content: 'x',
      mtimeMs: 100,
      offset: undefined,
      limit: undefined,
      isPartialView: true,
    });
    expect(store.matches('a.md', 100, undefined, undefined)).toBeUndefined();
  });

  it('invalidate removes a single entry, clear empties all', () => {
    const store = new ReadFileStateStore();
    store.set('a.md', {
      content: 'a',
      mtimeMs: 1,
      offset: undefined,
      limit: undefined,
      isPartialView: false,
    });
    store.set('b.md', {
      content: 'b',
      mtimeMs: 2,
      offset: undefined,
      limit: undefined,
      isPartialView: false,
    });
    store.invalidate('a.md');
    expect(store.get('a.md')).toBeUndefined();
    expect(store.get('b.md')?.content).toBe('b');
    store.clear();
    expect(store.get('b.md')).toBeUndefined();
  });
});
