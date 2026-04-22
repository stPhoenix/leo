import type { TodoStore, Todo } from '@/agent/todoStore';
import { validateTodo } from '@/agent/todoStore';
import type { ToolSpec } from './types';

export interface TodoWriteArgs {
  readonly newTodos: readonly Todo[];
}

export interface TodoWriteResult {
  readonly todos: readonly Todo[];
}

/**
 * Description text adapted from plan.md §3.3. Kept as a single constant so
 * a future iteration can swap in the verbatim SRS-pinned copy via a byte-
 * for-byte fixture assertion (deferred; see impl-1 deviation).
 */
export const TODO_WRITE_DESCRIPTION =
  'Manage a structured, in-memory todo list for the current agent session. Use this to plan multi-step work, track progress, and communicate intent to the user. Pass the complete desired todo list in `newTodos`; previous state is replaced. When all items are marked `completed`, the list is cleared but the completion set is returned so the caller can observe what was finished.';

export interface TodoWriteOptions {
  readonly store: TodoStore;
  readonly keyFor: (ctx: { thread: string; agentId?: string }) => string;
}

export function createTodoWriteTool(
  opts: TodoWriteOptions,
): ToolSpec<TodoWriteArgs, TodoWriteResult> {
  return {
    id: 'TodoWrite',
    description: TODO_WRITE_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        newTodos: {
          type: 'array',
          description: 'Complete replacement todo list.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              content: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'in-progress', 'completed'] },
              priority: { type: 'string', enum: ['low', 'medium', 'high'] },
              activeForm: { type: 'string' },
            },
            required: ['id', 'content', 'status'],
            additionalProperties: false,
          },
        },
      },
      required: ['newTodos'],
      additionalProperties: false,
    },
    requiresConfirmation: false,
    source: 'builtin',
    validate(raw) {
      if (raw === null || typeof raw !== 'object')
        return { ok: false, error: 'args must be object' };
      const obj = raw as Record<string, unknown>;
      if (!Array.isArray(obj.newTodos)) return { ok: false, error: 'newTodos must be array' };
      const out: Todo[] = [];
      for (const entry of obj.newTodos) {
        const v = validateTodo(entry);
        if (!v.ok) return { ok: false, error: v.error };
        out.push(v.value);
      }
      return { ok: true, data: { newTodos: out } };
    },
    async invoke(args, ctx) {
      const key = opts.keyFor({ thread: ctx.thread });
      opts.store.write(key, args.newTodos);
      return { ok: true, data: { todos: args.newTodos } };
    },
  };
}
