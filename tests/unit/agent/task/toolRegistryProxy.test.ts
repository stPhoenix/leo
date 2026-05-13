import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '@/tools/toolRegistry';
import type { ToolCtx, ToolResult, ToolSpec } from '@/tools/types';
import { SubagentToolRegistryProxy, TASK_FORBIDDEN_TOOL_IDS } from '@/agent/task/toolRegistryProxy';

function makeSpec(id: string): ToolSpec<{ q: string }, string> {
  const schema = z.object({ q: z.string() });
  return {
    id,
    description: `tool ${id}`,
    schema,
    parameters: { type: 'object', properties: { q: { type: 'string' } } },
    requiresConfirmation: false,
    source: 'builtin',
    validate: (raw): ToolResult<{ q: string }> => {
      const p = schema.safeParse(raw);
      return p.success ? { ok: true, data: p.data } : { ok: false, error: 'invalid' };
    },
    async invoke(args): Promise<ToolResult<string>> {
      return { ok: true, data: `${id}:${args.q}` };
    },
  };
}

function makeCtx(thread = 't-sub'): ToolCtx {
  return {
    thread,
    signal: new AbortController().signal,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vault: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    editor: {} as any,
  };
}

function makeParent(): ToolRegistry {
  const r = new ToolRegistry();
  r.register(makeSpec('read_note') as unknown as ToolSpec<unknown, unknown>);
  r.register(makeSpec('search_vault') as unknown as ToolSpec<unknown, unknown>);
  r.register(makeSpec('task') as unknown as ToolSpec<unknown, unknown>);
  r.register(makeSpec('delegate_external') as unknown as ToolSpec<unknown, unknown>);
  r.register(makeSpec('delegate_canvas_create') as unknown as ToolSpec<unknown, unknown>);
  r.register(makeSpec('delegate_canvas_content_edit') as unknown as ToolSpec<unknown, unknown>);
  r.register(makeSpec('delegate_canvas_layout_edit') as unknown as ToolSpec<unknown, unknown>);
  r.register(makeSpec('EnterPlanMode') as unknown as ToolSpec<unknown, unknown>);
  r.register(makeSpec('ExitPlanMode') as unknown as ToolSpec<unknown, unknown>);
  r.register(makeSpec('AskUserQuestion') as unknown as ToolSpec<unknown, unknown>);
  return r;
}

describe('SubagentToolRegistryProxy', () => {
  it('FORBIDDEN set contains every delegate / plan-mode / askUserQuestion id', () => {
    expect(TASK_FORBIDDEN_TOOL_IDS.has('task')).toBe(true);
    expect(TASK_FORBIDDEN_TOOL_IDS.has('delegate_external')).toBe(true);
    expect(TASK_FORBIDDEN_TOOL_IDS.has('delegate_canvas_create')).toBe(true);
    expect(TASK_FORBIDDEN_TOOL_IDS.has('delegate_canvas_content_edit')).toBe(true);
    expect(TASK_FORBIDDEN_TOOL_IDS.has('delegate_canvas_layout_edit')).toBe(true);
    expect(TASK_FORBIDDEN_TOOL_IDS.has('EnterPlanMode')).toBe(true);
    expect(TASK_FORBIDDEN_TOOL_IDS.has('ExitPlanMode')).toBe(true);
    expect(TASK_FORBIDDEN_TOOL_IDS.has('AskUserQuestion')).toBe(true);
  });

  it('lookup() returns undefined for forbidden ids and passes through otherwise', () => {
    const parent = makeParent();
    const proxy = new SubagentToolRegistryProxy(parent);
    expect(proxy.lookup('task')).toBeUndefined();
    expect(proxy.lookup('delegate_external')).toBeUndefined();
    expect(proxy.lookup('AskUserQuestion')).toBeUndefined();
    expect(proxy.lookup('read_note')).toBeDefined();
  });

  it('listFor() strips forbidden ids', () => {
    const parent = makeParent();
    const proxy = new SubagentToolRegistryProxy(parent);
    const list = proxy.listFor('t-sub').map((s) => s.id);
    expect(list).toContain('read_note');
    expect(list).toContain('search_vault');
    expect(list).not.toContain('task');
    expect(list).not.toContain('delegate_external');
    expect(list).not.toContain('delegate_canvas_create');
    expect(list).not.toContain('EnterPlanMode');
    expect(list).not.toContain('AskUserQuestion');
  });

  it('toOpenAITools() strips forbidden ids', () => {
    const parent = makeParent();
    const proxy = new SubagentToolRegistryProxy(parent);
    const names = proxy.toOpenAITools('t-sub').map((t) => t.function.name);
    expect(names).toContain('read_note');
    expect(names).not.toContain('task');
    expect(names).not.toContain('delegate_canvas_layout_edit');
  });

  it('invoke() refuses forbidden ids with a structured error', async () => {
    const parent = makeParent();
    const proxy = new SubagentToolRegistryProxy(parent);
    const result = await proxy.invoke('task', '{"q":"x"}', makeCtx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('forbidden');
  });

  it('invoke() delegates non-forbidden ids to the parent', async () => {
    const parent = makeParent();
    const proxy = new SubagentToolRegistryProxy(parent);
    const result = await proxy.invoke('read_note', '{"q":"x"}', makeCtx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBe('read_note:x');
  });

  it('register/unregister are not supported', () => {
    const parent = makeParent();
    const proxy = new SubagentToolRegistryProxy(parent);
    expect(() => proxy.register(makeSpec('x') as unknown as ToolSpec<unknown, unknown>)).toThrow();
    expect(() => proxy.unregister('x')).toThrow();
  });

  it('custom forbidden set overrides default', () => {
    const parent = makeParent();
    const proxy = new SubagentToolRegistryProxy(parent, new Set(['read_note']));
    expect(proxy.lookup('read_note')).toBeUndefined();
    // default-forbidden ids are now allowed through with this custom set
    expect(proxy.lookup('task')).toBeDefined();
  });
});
