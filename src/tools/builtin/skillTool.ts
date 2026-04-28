// Doc §6b `Skill` tool. Validate inputs, run skill through the shared slash
// processor, and return a sentinel envelope that `AgentRunner` recognises so
// it can splice the skill body into the current turn's messages.

import { z } from 'zod';
import type { SkillRegistry } from '@/skills/registry';
import type { ProcessResult, createSlashProcessor } from '@/skills/slashProcessor';
import type { ContextModifier, InvocationMessage } from '@/skills/types';
import type { ToolResult, ToolSpec } from '../types';
import { jsonSchemaFromZod } from '../zodAdapter';

export const SKILL_TOOL_ID = 'Skill';
export const SKILL_INVOCATION_SENTINEL = '__leo_skill_invocation__';

export interface SkillInvocationEnvelope {
  readonly [SKILL_INVOCATION_SENTINEL]: true;
  readonly skillName: string;
  readonly messages: readonly InvocationMessage[];
  readonly contextModifier?: ContextModifier;
}

export interface SkillToolArgs {
  readonly skill: string;
  readonly args?: string;
}

export interface SkillToolOptions {
  readonly registry: SkillRegistry;
  readonly processor: ReturnType<typeof createSlashProcessor>;
  readonly resolveAgentId?: (thread: string) => string;
  readonly resolveSessionId?: () => string | undefined;
  readonly resolveCwd?: () => string | undefined;
}

const SkillToolSchema: z.ZodType<SkillToolArgs> = z
  .object({
    skill: z.string().describe('Canonical skill name (e.g. "commit"). A leading "/" is stripped.'),
    args: z
      .string()
      .optional()
      .describe('Optional argument string passed to the skill body as $ARGUMENTS.'),
  })
  .strict() as unknown as z.ZodType<SkillToolArgs>;

export function createSkillTool(
  opts: SkillToolOptions,
): ToolSpec<SkillToolArgs, SkillInvocationEnvelope> {
  return {
    id: SKILL_TOOL_ID,
    description: 'Execute a skill within the main conversation.',
    schema: SkillToolSchema,
    parameters: jsonSchemaFromZod(SkillToolSchema),
    requiresConfirmation: false,
    source: 'builtin',
    // Validate retains the registry lookup + sentinel checks that pure zod can't express.
    validate(raw): ToolResult<SkillToolArgs> {
      if (raw === null || typeof raw !== 'object') {
        return { ok: false, error: 'expected object payload' };
      }
      const record = raw as Record<string, unknown>;
      const rawSkill = record['skill'];
      if (typeof rawSkill !== 'string' || rawSkill.trim().length === 0) {
        return { ok: false, error: '`skill` is required' };
      }
      const name = rawSkill.trim().replace(/^\//, '');
      if (name.length === 0) {
        return { ok: false, error: '`skill` must not be empty' };
      }
      const argsRaw = record['args'];
      const args = typeof argsRaw === 'string' ? argsRaw : undefined;
      const skill = opts.registry.findSkill(name);
      if (skill === undefined) {
        return { ok: false, error: `unknown skill: ${name}` };
      }
      if (skill.disableModelInvocation) {
        return { ok: false, error: `skill not model-invocable: ${name}` };
      }
      if (skill.type !== 'prompt') {
        return { ok: false, error: `non-prompt skill: ${name}` };
      }
      return {
        ok: true,
        data: args === undefined ? { skill: name } : { skill: name, args },
      };
    },
    async invoke(args, ctx): Promise<ToolResult<SkillInvocationEnvelope>> {
      const agentId = opts.resolveAgentId?.(ctx.thread) ?? ctx.agentId ?? '';
      const sessionId = opts.resolveSessionId?.();
      const cwd = opts.resolveCwd?.();
      const processed: ProcessResult = await opts.processor.process({
        skillName: args.skill,
        args: args.args ?? '',
        agentId,
        trigger: 'model',
        invocationContext: {
          threadId: ctx.thread,
          ...(sessionId !== undefined ? { sessionId } : {}),
          ...(cwd !== undefined ? { cwd } : {}),
        },
      });
      if (!processed.ok) {
        return { ok: false, error: processed.error };
      }
      const envelope: SkillInvocationEnvelope = {
        [SKILL_INVOCATION_SENTINEL]: true,
        skillName: processed.skillName,
        messages: processed.messages,
        ...(processed.contextModifier !== undefined
          ? { contextModifier: processed.contextModifier }
          : {}),
      };
      return { ok: true, data: envelope };
    },
  };
}

export function isSkillInvocationEnvelope(data: unknown): data is SkillInvocationEnvelope {
  return (
    data !== null &&
    typeof data === 'object' &&
    (data as Record<string, unknown>)[SKILL_INVOCATION_SENTINEL] === true
  );
}
