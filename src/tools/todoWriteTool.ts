import { z } from 'zod';
import type { TodoStore, Todo } from '@/agent/todoStore';
import type { ToolSpec } from './types';
import { jsonSchemaFromZod, validateFromZod } from './zodAdapter';
import { TODO_WRITE_DESCRIPTION } from '@/prompts/tools/todoWriteDescription';

export interface TodoWriteArgs {
  readonly newTodos: readonly Todo[];
}

export interface TodoWriteResult {
  readonly todos: readonly Todo[];
}

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
