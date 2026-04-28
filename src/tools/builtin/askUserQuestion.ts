import { z } from 'zod';
import type { Logger } from '@/platform/Logger';
import type { ClarifyingQuestionController } from '@/agent/clarifyingQuestionController';
import type { ToolSpec } from '../types';
import { jsonSchemaFromZod, validateFromZod } from '../zodAdapter';

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

export const ASK_USER_QUESTION_DESCRIPTION = [
  "Ask the user a single, specific question and wait for their answer. The answer is returned to you as the tool result. Most useful inside plan mode to resolve a structural choice the user's intent leaves ambiguous (flat vs hierarchical, MOC vs tag-driven, one deep note vs several connected notes).",
  '',
  '## When to use',
  '',
  '- A structural decision in a note-authoring task could reasonably go several ways and the user has not signalled a preference.',
  '- You need a short, specific piece of information from the user (a folder name, a tag, a chapter count) before continuing.',
  '',
  '## When NOT to use',
  '',
  '- Do NOT use this to ask "is the plan okay?" or "should I proceed?" — ExitPlanMode is the approval mechanism for plans.',
  '- Do NOT use this for open-ended discussion or to explain what you are going to do — write that in plain prose instead.',
  '- Do NOT use this when the user already gave specific instructions.',
  '',
  '## How to phrase',
  '',
  '- Provide 2–4 concrete `options` whenever possible. Each option should be mutually exclusive and short (≤ 80 chars). The user can always pick "Other" to provide free text.',
  '- Omit `options` only when the answer is genuinely freeform — a title, a folder path, a short phrase.',
  '- Use `multiSelect: true` only when the choices are not mutually exclusive (e.g. "Which of these tags should the note carry?").',
  '- Set a short `header` (≤ 20 chars) to label the question category — e.g. "Structure", "Naming", "Format".',
  '',
  '## Examples',
  '',
  '- question: "Should the chapters live as folders with sub-notes, or as flat files with frontmatter ordering?", options: ["folders", "flat"], header: "Structure".',
  '- question: "Which folder should the new project hub live in?", options: ["Areas/Projects", "Projects", "Vault root"], header: "Location".',
  '- question: "What should the hub note be titled?" (freeform — no options), header: "Naming".',
].join('\n');

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
