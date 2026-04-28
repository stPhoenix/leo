import { describe, expect, it, vi } from 'vitest';
import { createRevealInNoteTool } from '@/tools/builtin/revealInNote';
import type { RevealInput, WorkspaceNavigator } from '@/editor/workspaceNavigator';
import { makeToolCtx } from './_toolCtx';

interface FakeNavigator extends WorkspaceNavigator {
  readonly revealCalls: RevealInput[];
}

function fakeNavigator(impl?: WorkspaceNavigator['revealInNote']): FakeNavigator {
  const revealCalls: RevealInput[] = [];
  const reveal: WorkspaceNavigator['revealInNote'] =
    impl ??
    (async (input) => ({
      ok: true,
      status: 'revealed',
      from: 0,
      to: 0,
      ...{ _input: input },
    }));
  return {
    revealCalls,
    openNote: vi.fn(async () => ({ ok: true as const, status: 'opened' as const })),
    revealInNote: vi.fn(async (input: RevealInput) => {
      revealCalls.push(input);
      return reveal(input);
    }),
  };
}

describe('reveal_in_note tool — shape', () => {
  it('declares id, isReadOnly=true, requiresConfirmation=false, schema', () => {
    const tool = createRevealInNoteTool();
    expect(tool.id).toBe('reveal_in_note');
    expect(tool.requiresConfirmation).toBe(false);
    expect(tool.isReadOnly).toBe(true);
    expect(tool.parameters).toEqual(
      expect.objectContaining({
        type: 'object',
        required: expect.arrayContaining(['path', 'lineStart']),
      }),
    );
  });
});

describe('reveal_in_note tool — validation', () => {
  it('rejects negative lineStart', () => {
    const tool = createRevealInNoteTool();
    expect(tool.validate({ path: 'a.md', lineStart: -1 }).ok).toBe(false);
  });

  it('rejects lineEnd < lineStart', () => {
    const tool = createRevealInNoteTool();
    const result = tool.validate({ path: 'a.md', lineStart: 5, lineEnd: 2 });
    expect(result.ok).toBe(false);
  });

  it('accepts cursor-only (lineStart only)', () => {
    const tool = createRevealInNoteTool();
    expect(tool.validate({ path: 'a.md', lineStart: 0 }).ok).toBe(true);
  });

  it('accepts full ranges with chars', () => {
    const tool = createRevealInNoteTool();
    expect(tool.validate({ path: 'a.md', lineStart: 0, lineEnd: 2, chStart: 1, chEnd: 4 }).ok).toBe(
      true,
    );
  });

  it('rejects unsafe path', () => {
    const tool = createRevealInNoteTool();
    expect(tool.validate({ path: '../x.md', lineStart: 0 }).ok).toBe(false);
  });
});

describe('reveal_in_note tool — invocation', () => {
  it('happy path: cursor-only forwards lineStart, returns from/to', async () => {
    const navigator = fakeNavigator(async () => ({
      ok: true,
      status: 'revealed',
      from: 10,
      to: 10,
    }));
    const tool = createRevealInNoteTool();
    const validated = tool.validate({ path: 'a.md', lineStart: 3 });
    if (!validated.ok) return;
    const result = await tool.invoke(validated.data, makeToolCtx({ navigator }));
    expect(result).toEqual({
      ok: true,
      data: { path: 'a.md', from: 10, to: 10, status: 'revealed' },
    });
    expect(navigator.revealCalls[0]).toEqual({ path: 'a.md', lineStart: 3 });
  });

  it('forwards optional lineEnd/chStart/chEnd only when present', async () => {
    const navigator = fakeNavigator(async () => ({
      ok: true,
      status: 'revealed',
      from: 0,
      to: 5,
    }));
    const tool = createRevealInNoteTool();
    const validated = tool.validate({
      path: 'a.md',
      lineStart: 0,
      lineEnd: 2,
      chStart: 1,
      chEnd: 4,
    });
    if (!validated.ok) return;
    await tool.invoke(validated.data, makeToolCtx({ navigator }));
    expect(navigator.revealCalls[0]).toEqual({
      path: 'a.md',
      lineStart: 0,
      lineEnd: 2,
      chStart: 1,
      chEnd: 4,
    });
  });

  it('propagates navigator error', async () => {
    const navigator = fakeNavigator(async () => ({ ok: false, error: 'line out of range: 999' }));
    const tool = createRevealInNoteTool();
    const validated = tool.validate({ path: 'a.md', lineStart: 999 });
    if (!validated.ok) return;
    const result = await tool.invoke(validated.data, makeToolCtx({ navigator }));
    expect(result).toEqual({ ok: false, error: 'line out of range: 999' });
  });

  it('returns navigator-unavailable when ctx.navigator missing', async () => {
    const tool = createRevealInNoteTool();
    const validated = tool.validate({ path: 'a.md', lineStart: 0 });
    if (!validated.ok) return;
    const result = await tool.invoke(validated.data, makeToolCtx({}));
    expect(result).toEqual({ ok: false, error: 'navigator unavailable' });
  });

  it('returns aborted when signal already aborted', async () => {
    const navigator = fakeNavigator();
    const tool = createRevealInNoteTool();
    const ac = new AbortController();
    ac.abort();
    const validated = tool.validate({ path: 'a.md', lineStart: 0 });
    if (!validated.ok) return;
    const result = await tool.invoke(validated.data, makeToolCtx({ navigator, signal: ac.signal }));
    expect(result).toEqual({ ok: false, error: 'aborted' });
  });
});
