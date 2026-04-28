// Doc §10 turn-0 listing. Builds a single system-reminder attachment that
// announces newly-available skills to the model. Budget math follows the doc.

import type { SkillRegistry } from './registry';
import type { Skill } from './types';

const CHARS_PER_TOKEN = 4;
const FALLBACK_CHAR_BUDGET = 8000;
const PER_ENTRY_HARD_CAP = 250;
const MIN_DESCRIPTION_LENGTH = 20;

export interface BuildListingOptions {
  readonly registry: SkillRegistry;
  readonly agentId: string;
  readonly contextWindowTokens?: number;
  readonly isInitial?: boolean;
}

export interface ListingAttachment {
  readonly content: string;
  readonly skillCount: number;
  readonly isInitial: boolean;
  readonly skillNames: readonly string[];
}

export function buildSkillListingAttachment(opts: BuildListingOptions): ListingAttachment | null {
  const available = opts.registry.availableSkills();
  const sent = opts.registry.sentNamesFor(opts.agentId);
  const unsent = available.filter((skill) => !sent.has(skill.name) && skill.userInvocable);
  if (unsent.length === 0) return null;
  const budget = deriveBudget(opts.contextWindowTokens);
  const content = formatWithinBudget(unsent, budget);
  opts.registry.markSent(
    opts.agentId,
    unsent.map((s) => s.name),
  );
  return {
    content,
    skillCount: unsent.length,
    isInitial: opts.isInitial ?? sent.size === 0,
    skillNames: unsent.map((s) => s.name),
  };
}

function deriveBudget(contextWindowTokens: number | undefined): number {
  if (contextWindowTokens === undefined || contextWindowTokens <= 0) {
    return FALLBACK_CHAR_BUDGET;
  }
  return Math.max(FALLBACK_CHAR_BUDGET, Math.floor((contextWindowTokens * CHARS_PER_TOKEN) / 100));
}

function formatWithinBudget(skills: readonly Skill[], charBudget: number): string {
  const header = 'The following skills are available for use with the Skill tool:\n\n';
  const headerLen = header.length;
  const budget = Math.max(0, charBudget - headerLen);
  const full = skills.map((skill) => formatEntry(skill, PER_ENTRY_HARD_CAP)).join('\n');
  if (full.length <= budget) {
    return `${header}${full}`;
  }
  const nameOverhead = skills.reduce((acc, s) => acc + `- ${s.name}: `.length + 1, 0);
  const remaining = budget - nameOverhead;
  const maxDescLen = Math.max(0, Math.floor(remaining / skills.length));
  if (maxDescLen < MIN_DESCRIPTION_LENGTH) {
    const namesOnly = skills.map((s) => `- ${s.name}`).join('\n');
    return `${header}${namesOnly}`;
  }
  const truncated = skills
    .map((skill) => formatEntry(skill, Math.min(PER_ENTRY_HARD_CAP, maxDescLen)))
    .join('\n');
  return `${header}${truncated}`;
}

function formatEntry(skill: Skill, maxDescLen: number): string {
  const parts: string[] = [skill.description.trim()];
  if (skill.whenToUse !== undefined && skill.whenToUse.trim().length > 0) {
    parts.push(skill.whenToUse.trim());
  }
  const joined = parts.join(' - ');
  const truncated = joined.length > maxDescLen ? `${joined.slice(0, maxDescLen - 1)}…` : joined;
  return `- ${skill.name}: ${truncated}`;
}
