import { describe, expect, it } from 'vitest';
import {
  RunStateStore,
  statusOf,
  statusForBlock,
  EMPTY_RUN_STATE,
  type ProgressEvent,
} from '@/chat/runStateStore';
import type { ToolUseBlock } from '@/chat/types';

function block(id: string, decision?: ToolUseBlock['decision']): ToolUseBlock {
  return { type: 'tool_use', id, name: 'X', input: {}, ...(decision ? { decision } : {}) };
}

describe('runStateStore — mutators & precedence (F03 AC1, AC2)', () => {
  it('starts empty', () => {
    const s = new RunStateStore();
    expect(s.getSnapshot()).toBe(EMPTY_RUN_STATE);
  });

  it('markRunning then markResolved transitions queued → running → success', () => {
    const s = new RunStateStore();
    expect(statusOf(s.getSnapshot(), 'a')).toBe('queued');
    s.markRunning('a');
    expect(statusOf(s.getSnapshot(), 'a')).toBe('running');
    s.markResolved('a', false);
    expect(statusOf(s.getSnapshot(), 'a')).toBe('success');
  });

  it('markResolved with isError flips to errored', () => {
    const s = new RunStateStore();
    s.markRunning('a');
    s.markResolved('a', true);
    expect(statusOf(s.getSnapshot(), 'a')).toBe('errored');
  });

  it('rejected wins over running and canceled', () => {
    const s = new RunStateStore();
    s.markRunning('a');
    s.markRejected('a');
    expect(statusOf(s.getSnapshot(), 'a')).toBe('rejected');
  });

  it('canceled wins over errored and resolved', () => {
    const s = new RunStateStore();
    s.markResolved('a', true);
    s.markCanceled('a');
    expect(statusOf(s.getSnapshot(), 'a')).toBe('canceled');
  });

  it('block.decision === "deny" forces rejected via statusForBlock', () => {
    const s = new RunStateStore();
    expect(statusForBlock(s.getSnapshot(), block('a', 'deny'))).toBe('rejected');
  });

  it('cancelAllInProgress moves every running id to canceled', () => {
    const s = new RunStateStore();
    s.markRunning('a');
    s.markRunning('b');
    s.markRunning('c');
    s.markResolved('c', false);
    const cancelled = s.cancelAllInProgress();
    expect(new Set(cancelled)).toEqual(new Set(['a', 'b']));
    expect(statusOf(s.getSnapshot(), 'a')).toBe('canceled');
    expect(statusOf(s.getSnapshot(), 'b')).toBe('canceled');
    expect(statusOf(s.getSnapshot(), 'c')).toBe('success');
  });
});

describe('runStateStore — subscriptions (F03 AC3)', () => {
  it('subscribe fires on every mutation', () => {
    const s = new RunStateStore();
    let count = 0;
    s.subscribe(() => {
      count += 1;
    });
    s.markRunning('a');
    s.markResolved('a', false);
    expect(count).toBe(2);
  });

  it('subscribeToolUse only fires for the bound id', () => {
    const s = new RunStateStore();
    let fires = 0;
    s.subscribeToolUse('target', () => {
      fires += 1;
    });
    s.markRunning('other');
    s.markRunning('target');
    s.markResolved('other', false);
    s.markResolved('target', false);
    expect(fires).toBe(2); // running + resolved on target only
  });

  it('subscribeToolUse cleanup removes the listener', () => {
    const s = new RunStateStore();
    let fires = 0;
    const off = s.subscribeToolUse('a', () => {
      fires += 1;
    });
    s.markRunning('a');
    off();
    s.markResolved('a', false);
    expect(fires).toBe(1);
  });
});

describe('runStateStore — progress + permissions (F03 AC1)', () => {
  it('appendProgress accumulates events keyed by tool-use id', () => {
    const s = new RunStateStore();
    const ev: ProgressEvent = { kind: 'bash', toolUseId: 't', stdout: 'hi' };
    s.appendProgress('t', ev);
    s.appendProgress('t', { ...ev, stdout: 'there' });
    expect(s.getSnapshot().progressByToolUseId.get('t')?.length).toBe(2);
  });

  it('clearProgress removes entries for the id', () => {
    const s = new RunStateStore();
    s.appendProgress('t', { kind: 'bash', toolUseId: 't' });
    s.clearProgress('t');
    expect(s.getSnapshot().progressByToolUseId.has('t')).toBe(false);
  });

  it('recordPermissionRequest + clearPermissionRequest', () => {
    const s = new RunStateStore();
    s.recordPermissionRequest('t', {
      toolUseId: 't',
      toolId: 'editNote',
      thread: 'th',
      argsJson: '{}',
      category: 'write',
    });
    expect(s.getSnapshot().permissionRequests.has('t')).toBe(true);
    s.clearPermissionRequest('t');
    expect(s.getSnapshot().permissionRequests.has('t')).toBe(false);
  });
});

describe('runStateStore — tool results (F12 wiring)', () => {
  it('markResolved with result stores it on the snapshot', () => {
    const s = new RunStateStore();
    s.markRunning('a');
    s.markResolved('a', false, { ok: true, data: { path: 'x.md', before: 'a', after: 'b' } });
    const r = s.getSnapshot().toolResults.get('a');
    expect(r).toBeDefined();
    if (r === undefined) throw new Error('expected result');
    expect(r.ok).toBe(true);
    if (r.ok === true) {
      const data = r.data as { before: string; after: string };
      expect(data.before).toBe('a');
      expect(data.after).toBe('b');
    }
  });

  it('recordToolResult stores standalone', () => {
    const s = new RunStateStore();
    s.recordToolResult('a', { ok: false, error: 'boom' });
    const r = s.getSnapshot().toolResults.get('a');
    expect(r).toBeDefined();
    expect(r?.ok).toBe(false);
  });
});

describe('runStateStore — replay helper (F03 / F13 hand-off)', () => {
  it('blocksToCanceledMarker emits canceled tool_result for unresolved tool_use blocks', () => {
    const s = new RunStateStore();
    const blocks = [
      { type: 'tool_use' as const, id: 't1', name: 'X', input: {} },
      { type: 'tool_use' as const, id: 't2', name: 'Y', input: {} },
      { type: 'tool_result' as const, tool_use_id: 't1', content: 'ok' },
    ];
    const next = s.blocksToCanceledMarker(blocks);
    expect(next.length).toBe(4);
    const synthetic = next[3] as { type: string; tool_use_id?: string; content?: string };
    expect(synthetic.type).toBe('tool_result');
    expect(synthetic.tool_use_id).toBe('t2');
    expect(statusOf(s.getSnapshot(), 't2')).toBe('canceled');
    expect(statusOf(s.getSnapshot(), 't1')).toBe('queued');
  });
});
