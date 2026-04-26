import { describe, expect, it, vi } from 'vitest';
import { createOpenNoteTool } from '@/tools/builtin/openNote';
import type { WorkspaceNavigator } from '@/editor/workspaceNavigator';
import { makeToolCtx } from './_toolCtx';

function fakeNavigator(impl: Partial<WorkspaceNavigator> = {}): WorkspaceNavigator & {
  openCalls: string[];
} {
  const openCalls: string[] = [];
  return {
    openCalls,
    openNote: vi.fn(async (path: string) => {
      openCalls.push(path);
      return impl.openNote ? impl.openNote(path) : { ok: true as const, status: 'opened' as const };
    }),
    revealInNote: vi.fn(async () => ({
      ok: false as const,
      error: 'not used in open_note tests',
    })),
  };
}

describe('open_note tool — shape', () => {
  it('declares id, description, schema, requiresConfirmation=false, isReadOnly=true', () => {
    const tool = createOpenNoteTool();
    expect(tool.id).toBe('open_note');
    expect(tool.source).toBe('builtin');
    expect(tool.requiresConfirmation).toBe(false);
    expect(tool.isReadOnly).toBe(true);
    expect(tool.parameters).toEqual(
      expect.objectContaining({
        type: 'object',
        required: ['path'],
        additionalProperties: false,
      }),
    );
  });
});

describe('open_note tool — invocation', () => {
  it('happy path: opens via navigator and returns status', async () => {
    const navigator = fakeNavigator();
    const tool = createOpenNoteTool();
    const validated = tool.validate({ path: 'Notes/a.md' });
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const result = await tool.invoke(validated.data, makeToolCtx({ navigator }));
    expect(result).toEqual({
      ok: true,
      data: { path: 'Notes/a.md', status: 'opened' },
    });
    expect(navigator.openCalls).toEqual(['Notes/a.md']);
  });

  it('returns revealed when navigator reports already-open leaf', async () => {
    const navigator = fakeNavigator({
      openNote: async () => ({ ok: true, status: 'revealed' }),
    });
    const tool = createOpenNoteTool();
    const validated = tool.validate({ path: 'a.md' });
    if (!validated.ok) return;
    const result = await tool.invoke(validated.data, makeToolCtx({ navigator }));
    expect(result).toEqual({ ok: true, data: { path: 'a.md', status: 'revealed' } });
  });

  it('propagates navigator error', async () => {
    const navigator = fakeNavigator({
      openNote: async () => ({ ok: false, error: 'note not found: x.md' }),
    });
    const tool = createOpenNoteTool();
    const validated = tool.validate({ path: 'x.md' });
    if (!validated.ok) return;
    const result = await tool.invoke(validated.data, makeToolCtx({ navigator }));
    expect(result).toEqual({ ok: false, error: 'note not found: x.md' });
  });

  it('returns navigator-unavailable when ctx.navigator is missing', async () => {
    const tool = createOpenNoteTool();
    const validated = tool.validate({ path: 'a.md' });
    if (!validated.ok) return;
    const result = await tool.invoke(validated.data, makeToolCtx({}));
    expect(result).toEqual({ ok: false, error: 'navigator unavailable' });
  });

  it('rejects unsafe paths in validate', () => {
    const tool = createOpenNoteTool();
    expect(tool.validate({ path: '../escape.md' }).ok).toBe(false);
    expect(tool.validate({ path: '/abs.md' }).ok).toBe(false);
    expect(tool.validate({ path: '' }).ok).toBe(false);
    expect(tool.validate({}).ok).toBe(false);
  });

  it('returns aborted when signal already aborted', async () => {
    const navigator = fakeNavigator();
    const tool = createOpenNoteTool();
    const ac = new AbortController();
    ac.abort();
    const validated = tool.validate({ path: 'a.md' });
    if (!validated.ok) return;
    const result = await tool.invoke(validated.data, makeToolCtx({ navigator, signal: ac.signal }));
    expect(result).toEqual({ ok: false, error: 'aborted' });
  });
});
