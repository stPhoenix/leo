import { describe, expect, it } from 'vitest';
import { makeToolCtx } from './_toolCtx';
import { TodoStore, validateTodo } from '@/agent/todoStore';
import { createTodoWriteTool, TODO_WRITE_DESCRIPTION } from '@/tools/todoWriteTool';

describe('TodoStore', () => {
  it('write replaces the prior list', () => {
    const s = new TodoStore();
    s.write('a', [{ id: '1', content: 'c', status: 'pending' }]);
    expect(s.get('a').length).toBe(1);
    s.write('a', [
      { id: '2', content: 'd', status: 'pending' },
      { id: '3', content: 'e', status: 'in-progress' },
    ]);
    expect(s.get('a').length).toBe(2);
  });

  it('all-completed clears the list while returning newTodos verbatim via the TodoWrite tool', async () => {
    const s = new TodoStore();
    const tool = createTodoWriteTool({
      store: s,
      keyFor: (ctx) => ctx.thread,
    });
    const newTodos = [
      { id: '1', content: 'a', status: 'completed' as const },
      { id: '2', content: 'b', status: 'completed' as const },
    ];
    const v = tool.validate({ newTodos });
    if (!v.ok) throw new Error('validate');
    const res = await tool.invoke(v.data, makeToolCtx({ thread: 'k' }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.todos).toEqual(newTodos);
    expect(s.get('k')).toEqual([]);
  });

  it('TodoWrite tool rejects invalid todos via validate', () => {
    const s = new TodoStore();
    const tool = createTodoWriteTool({ store: s, keyFor: () => 'k' });
    expect(tool.validate({ newTodos: [{ id: '1' }] }).ok).toBe(false);
    expect(tool.validate({ newTodos: [{ id: '1', content: 'c', status: 'bogus' }] }).ok).toBe(
      false,
    );
    expect(tool.validate({ newTodos: 'not array' }).ok).toBe(false);
    expect(tool.validate({}).ok).toBe(false);
  });

  it('TodoWrite tool declares requiresConfirmation=false and a non-empty description (prompt placeholder)', () => {
    const tool = createTodoWriteTool({ store: new TodoStore(), keyFor: () => 'k' });
    expect(tool.requiresConfirmation).toBe(false);
    expect(tool.id).toBe('TodoWrite');
    expect(TODO_WRITE_DESCRIPTION.length).toBeGreaterThan(0);
  });

  it('validateTodo accepts a minimal valid Todo and rejects malformed ones', () => {
    expect(validateTodo({ id: '1', content: 'c', status: 'pending' }).ok).toBe(true);
    expect(validateTodo({ id: '', content: 'c', status: 'pending' }).ok).toBe(false);
    expect(validateTodo({ id: '1', content: '', status: 'pending' }).ok).toBe(false);
    expect(validateTodo({ id: '1', content: 'c', status: 'x' }).ok).toBe(false);
    expect(validateTodo({ id: '1', content: 'c', status: 'pending', priority: 'urgent' }).ok).toBe(
      false,
    );
    expect(validateTodo({ id: '1', content: 'c', status: 'pending', activeForm: '' }).ok).toBe(
      false,
    );
  });
});
