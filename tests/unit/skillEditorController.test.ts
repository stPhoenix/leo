import { describe, expect, it, vi } from 'vitest';
import {
  SkillEditorController,
  type SkillDraft,
  type SkillEditorStoreLike,
} from '@/skills/skillEditorController';
import type { Skill, SkillBlueprint } from '@/skills/types';

function stubSkill(name: string, description = 'desc'): Skill {
  return {
    type: 'prompt',
    name,
    displayName: name,
    description,
    allowedTools: [],
    disableModelInvocation: false,
    userInvocable: true,
    source: 'userSettings',
    loadedFrom: 'skills',
    contentLength: 10,
    isHidden: false,
    getPromptForCommand: async () => ({
      messages: [],
      finalContent: '',
      path: `.leo/skills/${name}/SKILL.md`,
    }),
  };
}

function mkStore(initial: Skill[] = []): SkillEditorStoreLike & {
  state: Map<string, Skill>;
  saves: SkillBlueprint[];
  deletes: string[];
} {
  const state = new Map(initial.map((s) => [s.name, s]));
  const saves: SkillBlueprint[] = [];
  const deletes: string[] = [];
  return {
    state,
    saves,
    deletes,
    listAll: () => [...state.values()],
    find: (name) => state.get(name),
    writeSkill: async (blueprint) => {
      saves.push(blueprint);
      const skill = stubSkill(blueprint.name, blueprint.description);
      state.set(blueprint.name, skill);
      return { skill, path: `.leo/skills/${blueprint.name}/SKILL.md` };
    },
    deleteSkill: async (name) => {
      deletes.push(name);
      state.delete(name);
    },
  };
}

function draftOf(overrides: Partial<SkillDraft> = {}): SkillDraft {
  return {
    name: 'my-skill',
    displayName: 'My Skill',
    description: 'desc',
    whenToUse: '',
    body: 'Do things carefully.',
    allowedTools: [],
    model: null,
    paths: [],
    argumentHint: null,
    argNames: [],
    disableModelInvocation: false,
    userInvocable: true,
    version: null,
    ...overrides,
  };
}

describe('SkillEditorController', () => {
  it('list returns every skill from the store', () => {
    const store = mkStore([stubSkill('alpha'), stubSkill('beta')]);
    const ctl = new SkillEditorController({ store });
    expect(
      ctl
        .list()
        .map((s) => s.name)
        .sort(),
    ).toEqual(['alpha', 'beta']);
  });

  it('openDraftForNew returns a fresh canonical name not colliding with existing', () => {
    const store = mkStore([stubSkill('general')]);
    const ctl = new SkillEditorController({ store, idGenerator: () => 'test-id' });
    const draft = ctl.openDraftForNew();
    expect(draft.name).toBe('test-id');
    expect(draft.displayName).toBe('New Skill');
  });

  it('validate flags missing required fields', () => {
    const ctl = new SkillEditorController({ store: mkStore() });
    const errors = ctl.validate(
      draftOf({ name: '', displayName: '  ', description: '', body: '' }),
      'create',
    );
    const fields = errors.map((e) => e.field).sort();
    expect(fields).toEqual(['body', 'description', 'displayName', 'name']);
  });

  it('validate flags non-kebab names', () => {
    const ctl = new SkillEditorController({ store: mkStore() });
    const errors = ctl.validate(draftOf({ name: 'Bad_NAME' }), 'create');
    expect(errors.some((e) => e.field === 'name')).toBe(true);
  });

  it('accepts namespaced parent:child names', () => {
    const ctl = new SkillEditorController({ store: mkStore() });
    const errors = ctl.validate(draftOf({ name: 'parent:child-skill' }), 'create');
    expect(errors.some((e) => e.field === 'name')).toBe(false);
  });

  it('rejects names with leading/trailing/double colons', () => {
    const ctl = new SkillEditorController({ store: mkStore() });
    for (const bad of [':child', 'parent:', 'parent::child', 'a:b:c']) {
      const errors = ctl.validate(draftOf({ name: bad }), 'create');
      expect(
        errors.some((e) => e.field === 'name'),
        `should reject "${bad}"`,
      ).toBe(true);
    }
  });

  it('validate flags duplicate names on create (but not on edit)', () => {
    const store = mkStore([stubSkill('writer')]);
    const ctl = new SkillEditorController({ store });
    const createErrors = ctl.validate(draftOf({ name: 'writer' }), 'create');
    expect(createErrors.some((e) => e.field === 'name-duplicate')).toBe(true);
    const editErrors = ctl.validate(draftOf({ name: 'writer' }), 'edit');
    expect(editErrors.some((e) => e.field === 'name-duplicate')).toBe(false);
  });

  it('save on valid draft writes the blueprint through the store', async () => {
    const store = mkStore();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const ctl = new SkillEditorController({ store, logger: logger as never });
    const res = await ctl.save(draftOf(), 'create');
    expect(res.ok).toBe(true);
    expect(store.saves).toHaveLength(1);
    expect(store.saves[0]?.name).toBe('my-skill');
    expect(logger.info).toHaveBeenCalledWith(
      'skills.editor.save',
      expect.objectContaining({ name: 'my-skill' }),
    );
  });

  it('save blocks on validation errors without calling the store', async () => {
    const store = mkStore();
    const ctl = new SkillEditorController({ store });
    const res = await ctl.save(draftOf({ name: 'BAD' }), 'create');
    expect(res.ok).toBe(false);
    if (!res.ok && 'errors' in res) {
      expect(res.errors.some((e) => e.field === 'name')).toBe(true);
    }
    expect(store.saves).toHaveLength(0);
  });

  it('deleteUserSkill removes via the store', async () => {
    const store = mkStore([stubSkill('writer')]);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const ctl = new SkillEditorController({ store, logger: logger as never });
    const res = await ctl.deleteUserSkill('writer');
    expect(res.ok).toBe(true);
    expect(store.deletes).toEqual(['writer']);
  });

  it('isDirty detects differences in every editable field', () => {
    const ctl = new SkillEditorController({ store: mkStore() });
    const base = draftOf();
    expect(ctl.isDirty(base, base)).toBe(false);
    expect(ctl.isDirty(base, { ...base, displayName: 'X' })).toBe(true);
    expect(ctl.isDirty(base, { ...base, body: 'Different' })).toBe(true);
    expect(ctl.isDirty(base, { ...base, allowedTools: ['Read'] })).toBe(true);
    expect(ctl.isDirty(base, { ...base, paths: ['src/**'] })).toBe(true);
  });
});
