import type { OpenAITool } from '@/providers/types';

export const REFINE_TOOLS: readonly OpenAITool[] = [
  {
    type: 'function',
    function: {
      name: 'ask_clarifying_question',
      description:
        'Ask the user a single, specific clarifying question before producing the final prompt. The user replies in the chat widget and the refine loop resumes.',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'The question to ask the user. Keep it short and specific.',
          },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'emit_final_prompt',
      description:
        'Emit the final, self-contained prompt to send verbatim to the external agent. Inline any required content; never reference vault paths.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'The final prompt the external agent will answer. Self-contained.',
          },
        },
        required: ['prompt'],
      },
    },
  },
];
