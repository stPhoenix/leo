export interface SkillExample {
  readonly user: string;
  readonly assistant: string;
}

export type SkillSource = 'builtin' | 'user';

export interface Skill {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly systemPrompt: string;
  readonly allowedTools?: readonly string[];
  readonly examples?: readonly SkillExample[];
  readonly defaultModel?: string;
  readonly source: SkillSource;
}

export type SkillParseResult =
  | { readonly ok: true; readonly skill: Skill }
  | { readonly ok: false; readonly error: string };
