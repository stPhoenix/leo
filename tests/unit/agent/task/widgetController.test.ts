import { describe, expect, it } from 'vitest';
import { TaskWidgetController } from '@/agent/task/widgetController';
import { tryParseTaskTerminalSnapshot } from '@/agent/task/terminalSnapshot';

function make(): TaskWidgetController {
  return new TaskWidgetController({
    runId: 'task-20260513-100000-abcdef',
    threadId: 't-1',
    prompt: 'count files',
  });
}

describe('TaskWidgetController', () => {
  it('initial phase = preparing with null timestamps', () => {
    const c = make();
    const vm = c.viewModel();
    expect(vm.phase).toBe('preparing');
    expect(vm.startedAt).toBeNull();
    expect(vm.endedAt).toBeNull();
  });

  it('setPhase(running) stamps startedAt', () => {
    const c = make();
    c.setPhase('running');
    const vm = c.viewModel();
    expect(vm.phase).toBe('running');
    expect(vm.startedAt).not.toBeNull();
    expect(vm.endedAt).toBeNull();
  });

  it('setPhase(done) stamps endedAt', () => {
    const c = make();
    c.setPhase('running');
    c.setPhase('done', { summary: 'OK' });
    const vm = c.viewModel();
    expect(vm.phase).toBe('done');
    expect(vm.endedAt).not.toBeNull();
    expect(vm.summary).toBe('OK');
  });

  it('noteToolCall increments counter and records lastToolId', () => {
    const c = make();
    c.noteToolCall('grep_vault');
    c.noteToolCall('read_note');
    const vm = c.viewModel();
    expect(vm.toolCallsCount).toBe(2);
    expect(vm.lastToolId).toBe('read_note');
  });

  it('recordError sets phase=error with code+message', () => {
    const c = make();
    c.recordError('no_summary', 'subagent produced no final text');
    const vm = c.viewModel();
    expect(vm.phase).toBe('error');
    expect(vm.error).toEqual({ code: 'no_summary', message: 'subagent produced no final text' });
    expect(vm.endedAt).not.toBeNull();
  });

  it('subscribe fires per update', () => {
    const c = make();
    const seen: string[] = [];
    const unsub = c.subscribe((vm) => seen.push(vm.phase));
    c.setPhase('running');
    c.setPhase('summarizing');
    c.setPhase('done');
    unsub();
    c.setPhase('error');
    expect(seen).toEqual(['running', 'summarizing', 'done']);
  });

  it('listener errors are isolated', () => {
    const c = make();
    c.subscribe(() => {
      throw new Error('boom');
    });
    expect(() => c.setPhase('running')).not.toThrow();
  });

  it('dispose stops further updates', () => {
    const c = make();
    const seen: string[] = [];
    c.subscribe((vm) => seen.push(vm.phase));
    c.dispose();
    c.setPhase('running');
    expect(seen).toEqual([]);
  });

  it('setDeadline patches deadlineMs and notifies listeners', () => {
    const c = make();
    const seen: Array<number | null> = [];
    c.subscribe((vm) => seen.push(vm.deadlineMs));
    expect(c.viewModel().deadlineMs).toBeNull();
    c.setDeadline(1_700_000_000_000);
    expect(c.viewModel().deadlineMs).toBe(1_700_000_000_000);
    c.setDeadline(null);
    expect(c.viewModel().deadlineMs).toBeNull();
    expect(seen).toEqual([1_700_000_000_000, null]);
  });

  it('reloadRehydrate produces phase=error code=reload', () => {
    const c = TaskWidgetController.reloadRehydrate({
      runId: 'task-x',
      threadId: 't-1',
      prompt: 'p',
    });
    expect(c.viewModel().phase).toBe('error');
    expect(c.viewModel().error?.code).toBe('reload');
  });

  it('terminal snapshot round-trips through Zod', () => {
    const c = make();
    c.setPhase('running');
    c.noteToolCall('read_note');
    c.update({ endedAt: (c.viewModel().startedAt ?? 0) + 4_200 });
    c.setPhase('done', { summary: '17' });
    const snap = c.toTerminalSnapshot();
    const parsed = tryParseTaskTerminalSnapshot(JSON.parse(JSON.stringify(snap)));
    expect(parsed).not.toBeNull();
    expect(parsed?.terminalPhase).toBe('done');
    expect(parsed?.toolCallsCount).toBe(1);
    expect(parsed?.summary).toBe('17');
  });
});
