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
      expect(segs[0].blocks.length).toBe(4);
    }
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
