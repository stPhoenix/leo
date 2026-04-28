export type TodoStatus = 'pending' | 'in-progress' | 'completed';
export type TodoPriority = 'low' | 'medium' | 'high';

export interface Todo {
  readonly id: string;
  readonly content: string;
  readonly status: TodoStatus;
  readonly priority?: TodoPriority;
  readonly activeForm?: string;
}

export class TodoStore {
  private readonly byKey = new Map<string, Todo[]>();

  get(key: string): readonly Todo[] {
    return this.byKey.get(key) ?? [];
  }

  write(key: string, todos: readonly Todo[]): void {
    const allDone = todos.length > 0 && todos.every((t) => t.status === 'completed');
    if (allDone) {
      this.byKey.set(key, []);
    } else {
      this.byKey.set(key, [...todos]);
    }
  }

  clear(key: string): void {
    this.byKey.delete(key);
  }

  dispose(): void {
    this.byKey.clear();
  }
}

export function validateTodo(
  raw: unknown,
): { ok: true; value: Todo } | { ok: false; error: string } {
  if (raw === null || typeof raw !== 'object') return { ok: false, error: 'todo must be object' };
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== 'string' || obj.id.length === 0)
    return { ok: false, error: 'id non-empty string required' };
  if (typeof obj.content !== 'string' || obj.content.length === 0)
    return { ok: false, error: 'content non-empty string required' };
  if (obj.status !== 'pending' && obj.status !== 'in-progress' && obj.status !== 'completed')
    return { ok: false, error: 'status must be pending|in-progress|completed' };
  const priority = obj.priority;
  if (priority !== undefined && priority !== 'low' && priority !== 'medium' && priority !== 'high')
    return { ok: false, error: 'priority must be low|medium|high when present' };
  const activeForm = obj.activeForm;
  if (activeForm !== undefined && (typeof activeForm !== 'string' || activeForm.length === 0))
    return { ok: false, error: 'activeForm must be non-empty string when present' };
  const out: Todo = {
    id: obj.id,
    content: obj.content,
    status: obj.status as TodoStatus,
    ...(priority !== undefined ? { priority: priority as TodoPriority } : {}),
    ...(activeForm !== undefined ? { activeForm: activeForm as string } : {}),
  };
  return { ok: true, value: out };
}
