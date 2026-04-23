import type { HooksSettings } from './hooks';

export type SkillSource =
  | 'userSettings'
  | 'projectSettings'
  | 'policySettings'
  | 'plugin'
  | 'bundled'
  | 'mcp';

export type SkillLoadedFrom =
  | 'skills'
  | 'commands_DEPRECATED'
  | 'plugin'
  | 'managed'
  | 'bundled'
  | 'mcp';

export type SkillContext = 'inline' | 'fork';

export type EffortValue = 'low' | 'medium' | 'high' | number;

export interface ShellSpec {
  readonly allowedCommands?: readonly string[];
  readonly timeoutMs?: number;
}

export interface SkillArgument {
  readonly name: string;
}

export interface InvocationContext {
  readonly sessionId?: string;
  readonly cwd?: string;
  readonly threadId?: string;
}

export interface InvocationMessage {
  readonly role: 'user' | 'system';
  readonly content: string;
  readonly marker?: string;
}

export interface ContextModifier {
  readonly allowedTools?: readonly string[];
  readonly model?: string;
  readonly effort?: EffortValue;
}

export interface InvocationResult {
  readonly messages: readonly InvocationMessage[];
  readonly contextModifier?: ContextModifier;
  readonly finalContent: string;
  readonly path: string;
}

export interface Skill {
  readonly type: 'prompt';
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly whenToUse?: string;
  readonly aliases?: readonly string[];
  readonly argumentHint?: string;
  readonly argNames?: readonly string[];
  readonly allowedTools: readonly string[];
  readonly model?: string;
  readonly effort?: EffortValue;
  readonly context?: SkillContext;
  readonly agent?: string;
  readonly hooks?: HooksSettings;
  readonly shell?: ShellSpec;
  readonly paths?: readonly string[];
  readonly disableModelInvocation: boolean;
  readonly userInvocable: boolean;
  readonly source: SkillSource;
  readonly loadedFrom: SkillLoadedFrom;
  readonly skillRoot?: string;
  readonly contentLength: number;
  readonly isHidden: boolean;
  readonly version?: string;
  getPromptForCommand(args: string, ctx: InvocationContext): Promise<InvocationResult>;
}

export type SkillParseResult =
  | { readonly ok: true; readonly skill: SkillBlueprint }
  | { readonly ok: false; readonly error: string };

export interface SkillBlueprint {
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly whenToUse?: string;
  readonly aliases?: readonly string[];
  readonly argumentHint?: string;
  readonly argNames?: readonly string[];
  readonly allowedTools: readonly string[];
  readonly model?: string;
  readonly effort?: EffortValue;
  readonly context?: SkillContext;
  readonly agent?: string;
  readonly hooks?: HooksSettings;
  readonly shell?: ShellSpec;
  readonly paths?: readonly string[];
  readonly disableModelInvocation: boolean;
  readonly userInvocable: boolean;
  readonly version?: string;
  readonly body: string;
}
