import { describe, expect, it, vi } from 'vitest';
import { ExcludeListStore } from '@/settings/excludeListStore';

describe('ExcludeListStore', () => {
  it('initial patterns are normalized + matcher compiled', () => {
    const store = new ExcludeListStore({ initial: ['  drafts/**  ', '', 'drafts/**'] });
    expect(store.list()).toEqual(['drafts/**']);
    expect(store.matcher()('drafts/a.md')).toBe(true);
    expect(store.matcher()('notes/a.md')).toBe(false);
  });

  it('set() emits subscribers with {current, previous} and recompiles the matcher', async () => {
    const store = new ExcludeListStore({ initial: ['drafts/**'] });
    const changes: Array<{ current: string[]; previous: string[] }> = [];
    const unsub = store.subscribe((current, previous) => {
      changes.push({ current: [...current], previous: [...previous] });
    });
    await store.set(['scratch/**']);
    expect(changes.length).toBe(1);
    expect(changes[0]?.previous).toEqual(['drafts/**']);
    expect(changes[0]?.current).toEqual(['scratch/**']);
    expect(store.matcher()('scratch/x.md')).toBe(true);
    expect(store.matcher()('drafts/x.md')).toBe(false);
    unsub();
  });

  it('set() with the same patterns is a no-op — no listener fire', async () => {
    const store = new ExcludeListStore({ initial: ['drafts/**'] });
    const listener = vi.fn();
    store.subscribe(listener);
    await store.set(['drafts/**']);
    expect(listener).not.toHaveBeenCalled();
  });

  it('empty initial list is a pure no-op matcher', () => {
    const store = new ExcludeListStore({ initial: [] });
    expect(store.matcher()('any/path.md')).toBe(false);
  });
});
