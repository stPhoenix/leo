import { roughTokenCountEstimation } from './tokenEstimator';

export interface SkillFrontmatter {
  readonly name: string;
  readonly description?: string;
  readonly whenToUse?: string;
  readonly systemPrompt?: string;
}

export interface SkillTokens {
  readonly name: string;
  readonly tokens: number;
}

export function estimateSkillFrontmatterTokens(skill: SkillFrontmatter): number {
  const parts = [
    skill.name,
    skill.description ?? '',
    skill.whenToUse ?? '',
    skill.systemPrompt ?? '',
  ];
  return roughTokenCountEstimation(parts.join('\n'));
}

export function countSkillFrontmatterTokens(skills: readonly SkillFrontmatter[]): {
  readonly total: number;
  readonly perSkill: readonly SkillTokens[];
} {
  const perSkill: SkillTokens[] = [];
  let total = 0;
  for (const s of skills) {
    const tokens = estimateSkillFrontmatterTokens(s);
    perSkill.push({ name: s.name, tokens });
    total += tokens;
  }
  return { total, perSkill };
}
