import { todoWriteInputSchema, type TodoWriteInput } from './schemas';
import { setTodos, type InlineAgentRunState, type InlineTodo } from '../runState';
import type { InlineAgentLoggerLite } from '../eventBridge';

export type TodoWriteResult =
  | {
      readonly ok: true;
      readonly data: {
        readonly todos: readonly InlineTodo[];
        readonly counts: {
          readonly pending: number;
          readonly in_progress: number;
          readonly completed: number;
        };
      };
    }
  | {
      readonly ok: false;
      readonly error: 'invalid_args' | 'duplicate_id' | 'too_many_in_progress';
    };

export interface TodoWriteCtx {
  readonly runState: InlineAgentRunState;
  readonly logger: InlineAgentLoggerLite;
}

export interface TodoWriteTool {
  readonly name: 'todo_write';
  invoke(input: unknown): Promise<TodoWriteResult>;
}

export function createTodoWriteTool(ctx: TodoWriteCtx): TodoWriteTool {
  return {
    name: 'todo_write',
    async invoke(input): Promise<TodoWriteResult> {
      let parsed: TodoWriteInput;
      try {
        parsed = todoWriteInputSchema.parse(input);
      } catch {
        return { ok: false, error: 'invalid_args' };
      }
      const ids = new Set<string>();
      for (const t of parsed.todos) {
        if (ids.has(t.id)) return { ok: false, error: 'duplicate_id' };
        ids.add(t.id);
      }
      const inProgress = parsed.todos.filter((t) => t.status === 'in_progress').length;
      if (inProgress > 1) return { ok: false, error: 'too_many_in_progress' };

      setTodos(ctx.runState, parsed.todos);
      const counts = {
        pending: parsed.todos.filter((t) => t.status === 'pending').length,
        in_progress: inProgress,
        completed: parsed.todos.filter((t) => t.status === 'completed').length,
      };
      ctx.logger.debug('externalAgent.adapter.inlineAgent.tool.todo_write', {
        total: parsed.todos.length,
        ...counts,
      });
      return {
        ok: true,
        data: { todos: ctx.runState.todos, counts },
      };
    },
  };
}
