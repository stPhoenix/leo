import { describe, expect, it } from 'vitest';
import { createInvokedSkillsStore } from '@/skills/invokedSkills';

describe('invokedSkillsStore', () => {
  it('deduplicates by skill name within an agent', () => {
    const store = createInvokedSkillsStore();
    store.record('a1', { skillName: 'x', path: 'p1', finalContent: 'body' });
    store.record('a1', { skillName: 'x', path: 'p2', finalContent: 'updated' });
    const list = store.listFor('a1');
    expect(list).toHaveLength(1);
    expect(list[0]?.finalContent).toBe('updated');
  });

  it('produces autocompact-compatible list', () => {
    const store = createInvokedSkillsStore();
    store.record('a1', { skillName: 'x', path: 'p', finalContent: 'c' });
    const list = store.toAutocompactList('a1');
    expect(list).toEqual([{ id: 'x', content: 'c' }]);
  });

  it('clears per-agent state', () => {
    const store = createInvokedSkillsStore();
    store.record('a1', { skillName: 'x', path: 'p', finalContent: 'c' });
    store.clearAgent('a1');
    expect(store.listFor('a1')).toEqual([]);
  });
});
