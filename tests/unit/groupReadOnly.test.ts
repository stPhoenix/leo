import { describe, expect, it } from 'vitest';
import { detectGroups } from '@/chat/groupReadOnly';
import { EMPTY_RUN_STATE, RunStateStore } from '@/chat/runStateStore';
import type { ContentBlock } from '@/chat/types';

const tu = (id: string, name: string): ContentBlock => ({
  type: 'tool_use',
  id,
  name,
  input: { path: `${id}.md` },
});

const tr = (toolUseId: string, content = 'ok'): ContentBlock => ({
  type: 'tool_result',
  tool_use_id: toolUseId,
  content,
});

const txt = (text: string): ContentBlock => ({ type: 'text', text });

const READ_ONLY = new Set(['readNote', 'searchVault']);
const isReadOnly = (n: string): boolean => READ_ONLY.has(n);

describe('detectGroups (F10 AC1)', () => {
  it('groups four successful read-only tool uses', () => {
    const blocks = [
      tu('1', 'readNote'),
      tu('2', 'readNote'),
      tu('3', 'readNote'),
      tu('4', 'readNote'),
    ];
    const rs = new RunStateStore();
    for (const b of blocks) {
      if (b.type === 'tool_use') {
        rs.markRunning(b.id);
        rs.markResolved(b.id, false);
      }
    }
    const segs = detectGroups({ blocks, runState: rs.getSnapshot(), isReadOnly });
    expect(segs.length).toBe(1);
    expect(segs[0]?.kind).toBe('group');
    if (segs[0]?.kind === 'group') {
      expect(segs[0].pairs.length).toBe(4);
      expect(segs[0].pairs.every((p) => p.result === undefined)).toBe(true);
    }
  });

  it('pairs each tool_use with its trailing tool_result', () => {
    const blocks = [
      tu('1', 'readNote'),
      tr('1', 'body 1'),
      tu('2', 'readNote'),
      tr('2', 'body 2'),
      tu('3', 'readNote'),
      tr('3', 'body 3'),
    ];
    const rs = new RunStateStore();
    for (const id of ['1', '2', '3']) {
      rs.markRunning(id);
      rs.markResolved(id, false);
    }
    const segs = detectGroups({ blocks, runState: rs.getSnapshot(), isReadOnly });
    expect(segs.length).toBe(1);
    expect(segs[0]?.kind).toBe('group');
    if (segs[0]?.kind === 'group') {
      expect(segs[0].pairs.length).toBe(3);
      expect(segs[0].indices).toEqual([0, 1, 2, 3, 4, 5]);
      expect(segs[0].pairs[0]?.result?.tool_use_id).toBe('1');
      expect(segs[0].pairs[1]?.result?.tool_use_id).toBe('2');
      expect(segs[0].pairs[2]?.result?.tool_use_id).toBe('3');
    }
  });

  it('mismatched tool_result tool_use_id is not paired', () => {
    const blocks = [tu('1', 'readNote'), tr('999'), tu('2', 'readNote')];
    const rs = new RunStateStore();
    for (const id of ['1', '2']) {
      rs.markRunning(id);
      rs.markResolved(id, false);
    }
    const segs = detectGroups({ blocks, runState: rs.getSnapshot(), isReadOnly });
    // tool_use #1 has no matching result; walker stops at the mismatched tr.
    // Since pairs.length=1 < min=2, the run collapses to singles.
    expect(segs[0]?.kind).toBe('single');
  });

  it('mid-failure splits run into singles', () => {
    const blocks = [tu('1', 'readNote'), tu('2', 'readNote'), tu('3', 'readNote')];
    const rs = new RunStateStore();
    rs.markRunning('1');
    rs.markResolved('1', false);
    rs.markRunning('2');
    rs.markResolved('2', true); // errored
    rs.markRunning('3');
    rs.markResolved('3', false);
    const segs = detectGroups({ blocks, runState: rs.getSnapshot(), isReadOnly });
    expect(segs.every((s) => s.kind === 'single')).toBe(true);
  });

  it('mixed names break the group', () => {
    const blocks = [tu('1', 'readNote'), tu('2', 'searchVault'), tu('3', 'readNote')];
    const rs = new RunStateStore();
    for (const b of blocks) {
      if (b.type === 'tool_use') {
        rs.markRunning(b.id);
        rs.markResolved(b.id, false);
      }
    }
    const segs = detectGroups({ blocks, runState: rs.getSnapshot(), isReadOnly });
    expect(segs.every((s) => s.kind === 'single')).toBe(true);
  });

  it('running members prevent grouping', () => {
    const blocks = [tu('1', 'readNote'), tu('2', 'readNote')];
    const rs = new RunStateStore();
    rs.markRunning('1');
    rs.markRunning('2');
    const segs = detectGroups({ blocks, runState: rs.getSnapshot(), isReadOnly });
    expect(segs.every((s) => s.kind === 'single')).toBe(true);
  });

  it('text blocks pass through unchanged', () => {
    const segs = detectGroups({
      blocks: [txt('hi'), txt('there')],
      runState: EMPTY_RUN_STATE,
      isReadOnly,
    });
    expect(segs.length).toBe(2);
    expect(segs.every((s) => s.kind === 'single')).toBe(true);
  });

  it('non-read-only tool uses do not group', () => {
    const blocks = [tu('1', 'editNote'), tu('2', 'editNote')];
    const rs = new RunStateStore();
    rs.markRunning('1');
    rs.markResolved('1', false);
    rs.markRunning('2');
    rs.markResolved('2', false);
    const segs = detectGroups({ blocks, runState: rs.getSnapshot(), isReadOnly });
    expect(segs.every((s) => s.kind === 'single')).toBe(true);
  });
});
