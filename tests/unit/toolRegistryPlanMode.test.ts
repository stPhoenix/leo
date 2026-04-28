import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '@/tools/toolRegistry';
import type { ToolCtx, ToolSpec } from '@/tools/types';
import { jsonSchemaFromZod, validateFromZod } from '@/tools/zodAdapter';

function dummySpec(
  id: string,
  requiresConfirmation = false,
): ToolSpec<{ x?: string }, { ok: true }> {
  const schema = z.object({ x: z.string().optional() });
  return {
    id,
    description: `dummy ${id}`,
    schema,
    parameters: jsonSchemaFromZod(schema),
    requiresConfirmation,
    isReadOnly: !requiresConfirmation,
    source: 'builtin',
    validate: validateFromZod(schema),
    async invoke() {
      return { ok: true, data: { ok: true } };
    },
  };
}

function fakeCtx(thread = 't1'): ToolCtx {
  return {
    thread,
    signal: new AbortController().signal,
    vault: {} as never,
    editor: {} as never,
  };
}

describe('ToolRegistry.listFor with planMode + allowedTools', () => {
  it('without options returns all registered tools', () => {
    const r = new ToolRegistry();
    r.register(dummySpec('read_note') as unknown as ToolSpec<unknown, unknown>);
    r.register(dummySpec('edit_note', true) as unknown as ToolSpec<unknown, unknown>);
    expect(
      r
        .listFor('t1')
        .map((s) => s.id)
        .sort(),
    ).toEqual(['edit_note', 'read_note']);
  });

  it('planMode=plan + isToolAllowedInPlan filters out write tools', () => {
    const r = new ToolRegistry({
      isToolAllowedInPlan: (id) => id === 'read_note',
    });
    r.register(dummySpec('read_note') as unknown as ToolSpec<unknown, unknown>);
    r.register(dummySpec('edit_note', true) as unknown as ToolSpec<unknown, unknown>);
    expect(r.listFor('t1', { planMode: 'plan' }).map((s) => s.id)).toEqual(['read_note']);
    expect(
      r
        .listFor('t1', { planMode: 'normal' })
        .map((s) => s.id)
        .sort(),
    ).toEqual(['edit_note', 'read_note']);
  });

  it('allowedTools intersects with the allowlist', () => {
    const r = new ToolRegistry();
    r.register(dummySpec('read_note') as unknown as ToolSpec<unknown, unknown>);
    r.register(dummySpec('edit_note', true) as unknown as ToolSpec<unknown, unknown>);
    r.register(dummySpec('search_vault') as unknown as ToolSpec<unknown, unknown>);
    const allowed = new Set(['read_note', 'search_vault']);
    expect(
      r
        .listFor('t1', { allowedTools: allowed })
        .map((s) => s.id)
        .sort(),
    ).toEqual(['read_note', 'search_vault']);
  });

  it('plan-mode and allowedTools combine (intersection)', () => {
    const r = new ToolRegistry({
      isToolAllowedInPlan: (id) => id === 'read_note' || id === 'search_vault',
    });
    r.register(dummySpec('read_note') as unknown as ToolSpec<unknown, unknown>);
    r.register(dummySpec('edit_note', true) as unknown as ToolSpec<unknown, unknown>);
    r.register(dummySpec('search_vault') as unknown as ToolSpec<unknown, unknown>);
    const allowed = new Set(['read_note', 'edit_note']);
    expect(r.listFor('t1', { planMode: 'plan', allowedTools: allowed }).map((s) => s.id)).toEqual([
      'read_note',
    ]);
  });
});

describe('ToolRegistry.invoke plan-mode pre-check', () => {
  it('blocks an invoke for a tool the predicate denies and records it', async () => {
    const recordToolBlocked = vi.fn();
    const r = new ToolRegistry({
      isToolAllowedInPlan: (id) => id === 'read_note',
      recordToolBlocked,
    });
    r.register(dummySpec('edit_note', true) as unknown as ToolSpec<unknown, unknown>);
    const result = await r.invoke('edit_note', '{}', fakeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('blocked by plan mode');
    expect(recordToolBlocked).toHaveBeenCalledWith('t1', 'edit_note');
  });

  it('does not block when the predicate is undefined', async () => {
    const r = new ToolRegistry();
    r.register(dummySpec('edit_note', true) as unknown as ToolSpec<unknown, unknown>);
    const result = await r.invoke('edit_note', '{}', fakeCtx());
    expect(result.ok).toBe(true);
  });

  it('does not block when predicate returns true', async () => {
    const r = new ToolRegistry({
      isToolAllowedInPlan: () => true,
    });
    r.register(dummySpec('edit_note', true) as unknown as ToolSpec<unknown, unknown>);
    const result = await r.invoke('edit_note', '{}', fakeCtx());
    expect(result.ok).toBe(true);
  });
});
