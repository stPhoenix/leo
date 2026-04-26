import { describe, expect, it } from 'vitest';
import {
  countSkillFrontmatterTokens,
  estimateSkillFrontmatterTokens,
} from '@/agent/skillTokenCount';
import { roughTokenCountEstimation } from '@/agent/tokenEstimator';

describe('skillTokenCount', () => {
  it('counts name + description + whenToUse + systemPrompt with no overhead', () => {
    const skill = {
      name: 'review',
      description: 'review pull request',
      whenToUse: 'when reviewing a PR',
      systemPrompt: 'You are a reviewer.',
    };
    const expected = roughTokenCountEstimation(
      ['review', 'review pull request', 'when reviewing a PR', 'You are a reviewer.'].join('\n'),
    );
    expect(estimateSkillFrontmatterTokens(skill)).toBe(expected);
  });

  it('handles missing optional fields', () => {
    expect(estimateSkillFrontmatterTokens({ name: 'a', description: 'b' })).toBe(
      roughTokenCountEstimation(['a', 'b', '', ''].join('\n')),
    );
  });

  it('aggregates total + perSkill', () => {
    const skills = [
      { name: 'a', description: 'desc one' },
      { name: 'b', description: 'desc two' },
    ];
    const r = countSkillFrontmatterTokens(skills);
    expect(r.perSkill).toHaveLength(2);
    expect(r.total).toBe(r.perSkill[0]!.tokens + r.perSkill[1]!.tokens);
  });
});
