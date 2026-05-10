import { z } from 'zod';
import type { Logger } from '@/platform/Logger';
import type { ClarifyingQuestionController } from '@/agent/clarifyingQuestionController';
import type { ToolSpec } from '../types';
import { jsonSchemaFromZod, validateFromZod } from '../zodAdapter';
import { ASK_USER_QUESTION_DESCRIPTION } from '@/prompts/tools/builtin/askUserQuestionDescription';

export interface AskUserQuestionArgs {
  readonly question: string;
  readonly header?: string;
  readonly options?: readonly string[];
  readonly multiSelect?: boolean;
}

export type AskUserQuestionResult =
  | { readonly answer: string }
  | { readonly answers: readonly string[] };

const AskUserQuestionSchema: z.ZodType<AskUserQuestionArgs> = z
  .object({
    question: z
      .string()
      .min(1, 'question must be non-empty')
      .max(500, 'question must be ≤ 500 chars')
      .describe('The question to ask the user. End with a question mark.'),
    header: z
      .string()
      .min(1)
      .max(20, 'header must be ≤ 20 chars')
      .optional()
      .describe('Short chip label for the dialog header (e.g. "Structure", "Format").'),
    options: z
      .array(z.string().min(1).max(80))
      .min(2, 'options must have at least 2 entries when present')
      .max(4, 'options must have at most 4 entries')
      .optional()
      .describe(
        'Optional 2–4 mutually exclusive choices. Omit only when the answer is genuinely freeform.',
      ),
    multiSelect: z
      .boolean()
      .optional()
      .describe('When true with options, the user may pick multiple. Default false.'),
  })
  .strict() as unknown as z.ZodType<AskUserQuestionArgs>;

export interface AskUserQuestionOptions {
  readonly controller: ClarifyingQuestionController;
  readonly logger?: Logger;
}

export function createAskUserQuestionTool(
  opts: AskUserQuestionOptions,
): ToolSpec<AskUserQuestionArgs, AskUserQuestionResult> {
  return {
    id: 'AskUserQuestion',
    description: ASK_USER_QUESTION_DESCRIPTION,
    schema: AskUserQuestionSchema,
    parameters: jsonSchemaFromZod(AskUserQuestionSchema),
    requiresConfirmation: false,
    isReadOnly: true,
    source: 'builtin',
    validate: validateFromZod(AskUserQuestionSchema),
    async invoke(args, ctx) {
      if (ctx.agentId !== null && ctx.agentId !== undefined && ctx.agentId.length > 0) {
        return { ok: false, error: 'AskUserQuestion forbidden in subagent context' };
      }
      opts.logger?.info('clarify.request', {
        threadId: ctx.thread,
        hasOptions: args.options !== undefined,
        multiSelect: args.multiSelect === true,
      });
      const outcome = await opts.controller.present({
        threadId: ctx.thread,
        question: args.question,
        ...(args.header !== undefined ? { header: args.header } : {}),
        ...(args.options !== undefined ? { options: args.options } : {}),
        ...(args.multiSelect !== undefined ? { multiSelect: args.multiSelect } : {}),
      });
      if (outcome.type === 'cancel') {
        opts.logger?.info('clarify.cancel', { threadId: ctx.thread });
        return { ok: false, error: 'user cancelled' };
      }
      if (outcome.type === 'answerMulti') {
        opts.logger?.info('clarify.answer', {
          threadId: ctx.thread,
          count: outcome.answers.length,
        });
        return { ok: true, data: { answers: outcome.answers } };
      }
      opts.logger?.info('clarify.answer', { threadId: ctx.thread, count: 1 });
      return { ok: true, data: { answer: outcome.answer } };
    },
  };
}
