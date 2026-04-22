import { describe, expect, it, vi } from 'vitest';
import {
  SkillEditorController,
  type SkillDraft,
  type SkillEditorStoreLike,
  type ThreadBindingsLookup,
} from '@/skills/skillEditorController';
import type { Skill } from '@/skills/types';

function mkStore(initial: Skill[] = []): SkillEditorStoreLike & {
  state: Map<string, Skill>;
  saves: Skill[];
  deletes: string[];
} {
  const state = new Map(initial.map((s) => [s.id, s]));
  const saves: Skill[] = [];
  const deletes: string[] = [];
  return {
    state,
    saves,
    deletes,
    list: () => [...state.values()],
    get: (id) => state.get(id),
    save: async (skill) => {
      if (skill.source !== 'user') throw new Error(`cannot save non-user: ${skill.source}`);
      saves.push(skill);
      state.set(skill.id, skill);
    },
    delete: async (id) => {
      deletes.push(id);
      state.delete(id);
    },
    cloneBuiltin: async (sourceId, newId) => {
      const source = state.get(sourceId);
      if (source === undefined || source.source !== 'builtin') {
        throw new Error(`unknown builtin: ${sourceId}`);
      }
      const clone: Skill = { ...source, id: newId, name: `${source.name} (copy)`, source: 'user' };
      state.set(newId, clone);
      saves.push(clone);
      return clone;
    },
  };
}

function mkThreadBindings(bound: Record<string, number>): ThreadBindingsLookup {
  return { countBound: (id) => bound[id] ?? 0 };
}

function draftOf(overrides: Partial<SkillDraft> = {}): SkillDraft {
  return {
    id: 'my-skill',
    name: 'My Skill',
    description: 'desc',
    systemPrompt: 'Do things carefully.',
    allowedTools: [],
    examples: [],
    defaultModel: null,
    ...overrides,
  };
}

const BUILTIN_GENERAL: Skill = {
  id: 'general',
  name: 'General',
  description: 'Default helper',
  systemPrompt: 'You are Leo.',
  source: 'builtin',
};

const USER_WRITER: Skill = {
  id: 'writer',
  name: 'Writer',
  description: 'Writing helper',
  systemPrompt: 'Rewrite prose.',
  source: 'user',
};

describe('SkillEditorController', () => {
  it('list returns every skill from the store (built-ins + user)', () => {
    const store = mkStore([BUILTIN_GENERAL, USER_WRITER]);
    const ctl = new SkillEditorController({ store });
    expect(
      ctl
        .list()
        .map((s) => s.id)
        .sort(),
    ).toEqual(['general', 'writer']);
  });

  it('openDraftForNew returns a fresh kebab id not colliding with existing', () => {
    const store = mkStore([BUILTIN_GENERAL]);
    const ctl = new SkillEditorController({ store, idGenerator: () => 'test-id' });
    const draft = ctl.openDraftForNew();
    expect(draft.id).toBe('test-id');
    expect(draft.name).toBe('New Skill');
  });

  it('isEditable false for built-ins, true for user skills', () => {
    const store = mkStore([BUILTIN_GENERAL, USER_WRITER]);
    const ctl = new SkillEditorController({ store });
    expect(ctl.isEditable('general')).toBe(false);
    expect(ctl.isEditable('writer')).toBe(true);
    expect(ctl.isEditable('nonexistent')).toBe(false);
  });

  it('validate flags missing required fields', () => {
    const ctl = new SkillEditorController({ store: mkStore() });
    const errors = ctl.validate(draftOf({ id: '', name: '   ', systemPrompt: '' }), 'create');
    const fields = errors.map((e) => e.field).sort();
    expect(fields).toEqual(['id', 'name', 'systemPrompt']);
  });

  it('validate flags non-kebab id', () => {
    const ctl = new SkillEditorController({ store: mkStore() });
    const errors = ctl.validate(draftOf({ id: 'Bad_ID' }), 'create');
    expect(errors.some((e) => e.field === 'id')).toBe(true);
  });

  it('validate flags duplicate id on create (but not on edit)', () => {
    const store = mkStore([USER_WRITER]);
    const ctl = new SkillEditorController({ store });
    const createErrors = ctl.validate(draftOf({ id: 'writer' }), 'create');
    expect(createErrors.some((e) => e.field === 'id-duplicate')).toBe(true);
    const editErrors = ctl.validate(draftOf({ id: 'writer' }), 'edit');
    expect(editErrors.some((e) => e.field === 'id-duplicate')).toBe(false);
  });

  it('save on valid draft persists through the store and emits skills.editor.save', async () => {
    const store = mkStore();
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const ctl = new SkillEditorController({ store, logger: logger as never });
    const res = await ctl.save(draftOf(), 'create');
    expect(res.ok).toBe(true);
    expect(store.saves.length).toBe(1);
    expect(store.saves[0]?.source).toBe('user');
    expect(logger.info).toHaveBeenCalledWith(
      'skills.editor.save',
      expect.objectContaining({ id: 'my-skill', source: 'user' }),
    );
  });

  it('save blocks on validation errors without calling the store', async () => {
    const store = mkStore();
    const ctl = new SkillEditorController({ store });
    const res = await ctl.save(draftOf({ id: 'BAD' }), 'create');
    expect(res.ok).toBe(false);
    if (!res.ok && 'errors' in res) {
      expect(res.errors.some((e) => e.field === 'id')).toBe(true);
    }
    expect(store.saves.length).toBe(0);
  });

  it('save blocks on duplicate id', async () => {
    const store = mkStore([USER_WRITER]);
    const ctl = new SkillEditorController({ store });
    const res = await ctl.save(draftOf({ id: 'writer' }), 'create');
    expect(res.ok).toBe(false);
    if (!res.ok && 'errors' in res) {
      expect(res.errors.some((e) => e.field === 'id-duplicate')).toBe(true);
    }
    expect(store.saves.length).toBe(0);
  });

  it('deleteConfirmationMessage includes bound-thread warning when threads > 0', () => {
    const store = mkStore([USER_WRITER]);
    const ctl = new SkillEditorController({
      store,
      threadBindings: mkThreadBindings({ writer: 3 }),
    });
    const msg = ctl.deleteConfirmationMessage('writer');
    expect(msg).toContain('Writer');
    expect(msg).toContain('3');
    expect(msg).toContain('General');
  });

  it('deleteConfirmationMessage omits the warning when threads === 0', () => {
    const store = mkStore([USER_WRITER]);
    const ctl = new SkillEditorController({
      store,
      threadBindings: mkThreadBindings({}),
    });
    const msg = ctl.deleteConfirmationMessage('writer');
    expect(msg).not.toContain('fall back');
  });

  it('deleteUserSkill rejects built-ins', async () => {
    const store = mkStore([BUILTIN_GENERAL]);
    const ctl = new SkillEditorController({ store });
    const res = await ctl.deleteUserSkill('general');
    expect(res.ok).toBe(false);
    expect(store.deletes).toEqual([]);
  });

  it('deleteUserSkill removes a user skill and logs skills.editor.delete', async () => {
    const store = mkStore([USER_WRITER]);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const ctl = new SkillEditorController({ store, logger: logger as never });
    const res = await ctl.deleteUserSkill('writer');
    expect(res.ok).toBe(true);
    expect(store.deletes).toEqual(['writer']);
    expect(logger.info).toHaveBeenCalledWith(
      'skills.editor.delete',
      expect.objectContaining({ id: 'writer', source: 'user' }),
    );
  });

  it('duplicate(builtin) routes through cloneBuiltin and logs skills.editor.duplicate', async () => {
    const store = mkStore([BUILTIN_GENERAL]);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const ctl = new SkillEditorController({ store, logger: logger as never });
    const res = await ctl.duplicate('general');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.skill.id).toBe('general-copy');
      expect(res.skill.source).toBe('user');
      expect(res.skill.name).toBe('General (copy)');
    }
    expect(logger.info).toHaveBeenCalledWith(
      'skills.editor.duplicate',
      expect.objectContaining({ fromId: 'general', newId: 'general-copy' }),
    );
  });

  it('duplicate(user) saves a fresh copy via SkillsStore.save', async () => {
    const store = mkStore([USER_WRITER]);
    const ctl = new SkillEditorController({ store });
    const res = await ctl.duplicate('writer');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.skill.id).toBe('writer-copy');
      expect(res.skill.name).toBe('Writer (copy)');
      expect(res.skill.source).toBe('user');
    }
  });

  it('duplicate avoids id collision on repeat duplicates', async () => {
    const store = mkStore([BUILTIN_GENERAL]);
    const ctl = new SkillEditorController({ store });
    await ctl.duplicate('general');
    const res = await ctl.duplicate('general');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.skill.id).toBe('general-copy-2');
    }
  });

  it('isDirty detects differences in every editable field', () => {
    const ctl = new SkillEditorController({ store: mkStore() });
    const a = draftOf();
    expect(ctl.isDirty(a, a)).toBe(false);
    expect(ctl.isDirty(a, { ...a, name: 'X' })).toBe(true);
    expect(ctl.isDirty(a, { ...a, description: 'D' })).toBe(true);
    expect(ctl.isDirty(a, { ...a, systemPrompt: 'S' })).toBe(true);
    expect(ctl.isDirty(a, { ...a, allowedTools: ['read_note'] })).toBe(true);
    expect(ctl.isDirty(a, { ...a, examples: [{ user: 'u', assistant: 'a' }] })).toBe(true);
    expect(ctl.isDirty(a, { ...a, defaultModel: 'gpt-4' })).toBe(true);
  });

  it('save surfaces store errors as Notice + log event + ok:false', async () => {
    const store = mkStore();
    (store as unknown as { save: () => Promise<void> }).save = async () => {
      throw new Error('disk-full');
    };
    const notice = { notify: vi.fn() };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const ctl = new SkillEditorController({ store, logger: logger as never, notice });
    const res = await ctl.save(draftOf(), 'create');
    expect(res.ok).toBe(false);
    expect(notice.notify).toHaveBeenCalledWith(expect.stringContaining('disk-full'));
    expect(logger.error).toHaveBeenCalledWith('skills.editor.save-failed', expect.any(Object));
  });
});
