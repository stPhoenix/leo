// Doc §6a/§6b shared entry point. Produces the messages + modifiers that both
// the slash-command and Skill-tool paths inject into the current turn, plus
// the invoked-skill record used for compaction survival.

import type { Logger } from '@/platform/Logger';
import type { SkillRegistry } from './registry';
import type { InvokedSkillsStore } from './invokedSkills';
import type {
  ContextModifier,
  InvocationContext,
  InvocationMessage,
  InvocationResult,
} from './types';

export interface SlashProcessorOptions {
  readonly registry: SkillRegistry;
  readonly invoked: InvokedSkillsStore;
  readonly logger?: Logger;
}

export interface ProcessRequest {
  readonly skillName: string;
  readonly args: string;
  readonly agentId: string;
  readonly invocationContext: InvocationContext;
  readonly trigger: 'user' | 'model';
}

export type ProcessResult =
  | {
      readonly ok: true;
      readonly messages: readonly InvocationMessage[];
      readonly contextModifier?: ContextModifier;
      readonly skillName: string;
      readonly result: InvocationResult;
    }
  | { readonly ok: false; readonly error: string };

export function createSlashProcessor(opts: SlashProcessorOptions) {
  return {
    async process(req: ProcessRequest): Promise<ProcessResult> {
      const skill = opts.registry.findSkill(req.skillName);
      if (skill === undefined) {
        return { ok: false, error: `unknown skill: ${req.skillName}` };
      }
      if (req.trigger === 'model' && skill.disableModelInvocation) {
        return { ok: false, error: `skill not model-invocable: ${req.skillName}` };
      }
      const invocation = await skill.getPromptForCommand(req.args, req.invocationContext);
      const modifier = deriveContextModifier(skill.allowedTools, skill.model, skill.effort);
      opts.invoked.record(req.agentId, {
        skillName: skill.name,
        path: invocation.path,
        finalContent: invocation.finalContent,
      });
      opts.logger?.info('skills.invoke', {
        skill: skill.name,
        trigger: req.trigger,
        agentId: req.agentId,
        args: req.args,
      });
      return {
        ok: true,
        messages: invocation.messages,
        ...(modifier !== undefined ? { contextModifier: modifier } : {}),
        skillName: skill.name,
        result: invocation,
      };
    },
  };
}

function deriveContextModifier(
  allowedTools: readonly string[] | undefined,
  model: string | undefined,
  effort: ContextModifier['effort'] | undefined,
): ContextModifier | undefined {
  if (
    (allowedTools === undefined || allowedTools.length === 0) &&
    model === undefined &&
    effort === undefined
  ) {
    return undefined;
  }
  const modifier: ContextModifier = {
    ...(allowedTools !== undefined && allowedTools.length > 0 ? { allowedTools } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(effort !== undefined ? { effort } : {}),
  };
  return modifier;
}
