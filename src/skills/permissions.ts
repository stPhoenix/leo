// Doc §14 permissions. Safe-property allowlist ensures new frontmatter fields
// default to asking the user rather than silently auto-allowing.

import type { Skill } from './types';

export type PermissionRule =
  | { readonly kind: 'exact'; readonly name: string }
  | { readonly kind: 'prefix'; readonly prefix: string };

export interface PermissionRuleset {
  readonly allow: readonly PermissionRule[];
  readonly deny: readonly PermissionRule[];
}

export type PermissionDecision = 'allow' | 'deny' | 'ask';

export interface PermissionCheck {
  readonly decision: PermissionDecision;
  readonly reason: string;
  readonly suggestedRules?: readonly PermissionRule[];
}

const SAFE_PROPERTIES: ReadonlySet<string> = new Set([
  'type',
  'name',
  'displayName',
  'description',
  'whenToUse',
  'aliases',
  'argumentHint',
  'argNames',
  'allowedTools',
  'model',
  'effort',
  'context',
  'agent',
  'hooks',
  'shell',
  'paths',
  'disableModelInvocation',
  'userInvocable',
  'source',
  'loadedFrom',
  'skillRoot',
  'contentLength',
  'isHidden',
  'version',
  'getPromptForCommand',
]);

export function parsePermissionRule(raw: string): PermissionRule | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.endsWith(':*')) {
    const prefix = trimmed.slice(0, -2);
    if (prefix.length === 0) return null;
    return { kind: 'prefix', prefix };
  }
  return { kind: 'exact', name: trimmed };
}

export function matchesRule(rule: PermissionRule, name: string): boolean {
  if (rule.kind === 'exact') return rule.name === name;
  return name === rule.prefix || name.startsWith(`${rule.prefix}-`);
}

export function checkSkillPermissions(skill: Skill, rules: PermissionRuleset): PermissionCheck {
  for (const rule of rules.deny) {
    if (matchesRule(rule, skill.name)) {
      return { decision: 'deny', reason: 'deny-rule' };
    }
  }
  if (isSafeSkill(skill)) {
    return { decision: 'allow', reason: 'auto-allow-safe' };
  }
  for (const rule of rules.allow) {
    if (matchesRule(rule, skill.name)) {
      return { decision: 'allow', reason: 'allow-rule' };
    }
  }
  return {
    decision: 'ask',
    reason: 'unknown',
    suggestedRules: [
      { kind: 'exact', name: skill.name },
      { kind: 'prefix', prefix: skill.name.split('-')[0] ?? skill.name },
    ],
  };
}

function isSafeSkill(skill: Skill): boolean {
  for (const key of Object.keys(skill)) {
    if (!SAFE_PROPERTIES.has(key)) {
      return false;
    }
  }
  return !skill.disableModelInvocation || skill.context !== 'fork';
}
