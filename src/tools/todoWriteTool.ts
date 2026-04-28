import { z } from 'zod';
import type { TodoStore, Todo } from '@/agent/todoStore';
import type { ToolSpec } from './types';
import { jsonSchemaFromZod, validateFromZod } from './zodAdapter';

export interface TodoWriteArgs {
  readonly newTodos: readonly Todo[];
}

export interface TodoWriteResult {
  readonly todos: readonly Todo[];
}

export const TODO_WRITE_DESCRIPTION = [
  'Manage a structured, in-memory todo list for the current note-authoring session. Pass the complete desired todo list in `newTodos`; previous state is replaced. When all items are `completed`, the persisted list is cleared but the completion set is returned so the caller can observe what was finished.',
  '',
  '## When to use',
  '',
  '1. Multi-step authoring tasks — when a request requires 3+ distinct actions (creating multiple notes, editing several, retagging, restructuring).',
  '2. Non-trivial work — careful sequencing matters (e.g. create hub before linking concept notes; create folders before notes).',
  '3. User explicitly asks for a todo list, or supplies multiple tasks in a numbered/comma-separated list.',
  '4. After receiving new instructions — capture the requirements as todos immediately.',
  '5. Before starting work on a todo — mark it in-progress (only ONE in-progress at a time).',
  '6. After finishing a todo — mark it completed and add any newly discovered follow-ups.',
  '',
  '## When NOT to use',
  '',
  '- Single-line additions or trivial edits in one note.',
  '- Single short note creation with content the user already specified.',
  '- Pure informational queries about Obsidian or vault contents.',
  '- The whole task can be completed in 2 or fewer trivial steps.',
  '',
  '## Examples — USE the todo list',
  '',
  '- "Create a hub note plus 5 concept notes for my dissertation on consensus algorithms" — multi-note structure with linking, sequencing matters.',
  '- "Restructure my reading-notes folder into MOC + concept notes with backlinks" — touches many notes, multi-step.',
  '- "Build a vault for my book project: chapters, character bios, world-building, timeline" — multiple feature-areas, each a sub-task.',
  '- "Refactor my journal: extract recurring themes into concept notes and link from existing dailies" — multi-pass refactor.',
  '',
  '## Examples — do NOT use the todo list',
  '',
  '- "What\'s the syntax for a callout block?" — informational.',
  '- "How do tags work in Obsidian?" — informational.',
  '- "Add tag #review to this note" — single trivial action.',
  "- \"Create a quick scratch note titled 'Today's idea'\" — single trivial creation.",
  '',
  '## States and rules',
  '',
  '- States: `pending`, `in-progress`, `completed`.',
  '- Exactly ONE todo is `in-progress` at a time. Never less, never more, while there are pending items.',
  '- Mark `completed` ONLY when fully done. If you hit an error, leave the todo `in-progress` and create a follow-up todo describing what is blocked.',
  '- Remove todos that become irrelevant — drop them from `newTodos` rather than marking completed.',
  '- Each item needs a clear, specific `content` (imperative). Optionally include `activeForm` (present continuous) for the live spinner — recommended.',
].join('\n');

export interface TodoWriteOptions {
  readonly store: TodoStore;
  readonly keyFor: (ctx: { thread: string; agentId?: string }) => string;
}

const TodoSchema = z
  .object({
    id: z.string().min(1, 'id non-empty string required'),
    content: z.string().min(1, 'content non-empty string required'),
    status: z.enum(['pending', 'in-progress', 'completed'], {
      error: 'status must be pending|in-progress|completed',
    }),
    priority: z
      .enum(['low', 'medium', 'high'], { error: 'priority must be low|medium|high when present' })
      .optional(),
    activeForm: z.string().min(1, 'activeForm must be non-empty string when present').optional(),
  })
  .strict();

const TodoWriteSchema: z.ZodType<TodoWriteArgs> = z
  .object({
    newTodos: z.array(TodoSchema).describe('Complete replacement todo list.'),
  })
  .strict() as unknown as z.ZodType<TodoWriteArgs>;

export function createTodoWriteTool(
  opts: TodoWriteOptions,
): ToolSpec<TodoWriteArgs, TodoWriteResult> {
  return {
    id: 'TodoWrite',
    description: TODO_WRITE_DESCRIPTION,
    schema: TodoWriteSchema,
    parameters: jsonSchemaFromZod(TodoWriteSchema),
    requiresConfirmation: false,
    source: 'builtin',
    validate: validateFromZod(TodoWriteSchema),
    async invoke(args, ctx) {
      const key = opts.keyFor({ thread: ctx.thread });
      opts.store.write(key, args.newTodos);
      return { ok: true, data: { todos: args.newTodos } };
    },
  };
}
