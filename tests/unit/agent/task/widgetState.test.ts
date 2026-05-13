import { describe, expect, it } from 'vitest';
import {
  isTerminalTaskPhase,
  makeInitialTaskViewModel,
  TERMINAL_TASK_PHASES,
  type TaskPhase,
} from '@/agent/task/widgetState';

describe('TaskViewModel state helpers', () => {
  it('initial view model starts in preparing phase with zero counters', () => {
    const vm = makeInitialTaskViewModel({
      runId: 'task-x',
      threadId: 't-1',
      prompt: 'do the thing',
    });
    expect(vm.phase).toBe('preparing');
    expect(vm.startedAt).toBeNull();
    expect(vm.endedAt).toBeNull();
    expect(vm.toolCallsCount).toBe(0);
    expect(vm.lastToolId).toBeNull();
    expect(vm.summary).toBeNull();
    expect(vm.error).toBeNull();
    expect(vm.runId).toBe('task-x');
    expect(vm.threadId).toBe('t-1');
    expect(vm.prompt).toBe('do the thing');
  });

  it('TERMINAL_TASK_PHASES contains exactly done/cancelled/error', () => {
    expect([...TERMINAL_TASK_PHASES].sort()).toEqual(['cancelled', 'done', 'error']);
  });

  it('isTerminalTaskPhase agrees with TERMINAL_TASK_PHASES', () => {
    const all: TaskPhase[] = ['preparing', 'running', 'summarizing', 'done', 'cancelled', 'error'];
    for (const p of all) {
      expect(isTerminalTaskPhase(p)).toBe(TERMINAL_TASK_PHASES.has(p));
    }
  });
});
