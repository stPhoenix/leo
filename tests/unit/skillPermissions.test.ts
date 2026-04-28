import { describe, expect, it } from 'vitest';
import { checkSkillPermissions, matchesRule, parsePermissionRule } from '@/skills/permissions';
import type { Skill } from '@/skills/types';

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    type: 'prompt',
    name: 'demo',
    displayName: 'Demo',
    description: 'Demo skill',
    allowedTools: [],
    disableModelInvocation: false,
    userInvocable: true,
    source: 'userSettings',
    loadedFrom: 'skills',
    contentLength: 0,
    isHidden: false,
    getPromptForCommand: async () => ({ messages: [], finalContent: '', path: '' }),
    ...overrides,
  };
}

describe('permission rules', () => {
  it('parses exact and prefix rules', () => {
    expect(parsePermissionRule('commit')).toEqual({ kind: 'exact', name: 'commit' });
    expect(parsePermissionRule('review:*')).toEqual({ kind: 'prefix', prefix: 'review' });
    expect(parsePermissionRule('')).toBeNull();
  });

  it('matches exact and prefix rules', () => {
    expect(matchesRule({ kind: 'exact', name: 'commit' }, 'commit')).toBe(true);
    expect(matchesRule({ kind: 'prefix', prefix: 'review' }, 'review-pr')).toBe(true);
    expect(matchesRule({ kind: 'prefix', prefix: 'review' }, 'review')).toBe(true);
    expect(matchesRule({ kind: 'prefix', prefix: 'review' }, 'other')).toBe(false);
  });
});

describe('checkSkillPermissions', () => {
  it('denies when matched by a deny rule', () => {
    const decision = checkSkillPermissions(makeSkill(), {
      allow: [],
      deny: [{ kind: 'exact', name: 'demo' }],
    });
    expect(decision.decision).toBe('deny');
  });

  it('auto-allows safe skills', () => {
    const decision = checkSkillPermissions(makeSkill(), { allow: [], deny: [] });
    expect(decision.decision).toBe('allow');
    expect(decision.reason).toBe('auto-allow-safe');
  });

  it('asks when unsafe property present', () => {
    const skill = makeSkill();
    (skill as unknown as Record<string, unknown>).experimentalField = true;
    const decision = checkSkillPermissions(skill, { allow: [], deny: [] });
    expect(decision.decision).toBe('ask');
    expect(decision.suggestedRules).toBeDefined();
  });
});
