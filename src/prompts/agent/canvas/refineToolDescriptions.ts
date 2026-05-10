import type { OpenAITool } from '@/providers/types';

export const CANVAS_REFINE_TOOLS: readonly OpenAITool[] = [
  {
    type: 'function',
    function: {
      name: 'ask_clarifying_question',
      description:
        'Ask the user a single short clarifying question. The driver gives up after a small bounded number of questions.',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'The question text. <= 120 chars.',
          },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'emit_run_plan',
      description:
        'Emit the final schema-conformant RunPlan describing entityTypes, relationTypes, sourceHints, layoutHint, optional scope, and outputPath.',
      parameters: {
        type: 'object',
        properties: { plan: { type: 'object' } },
        required: ['plan'],
      },
    },
  },
];
