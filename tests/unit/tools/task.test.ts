import { describe, expect, it, vi } from 'vitest';
import { ConfirmationController } from '@/agent/confirmationController';
import { createTaskTool, TASK_TOOL_ID } from '@/tools/builtin/task';
import type {
  TaskOrchestrator,
  TaskOrchestratorStartResult,
  TaskRunHandle,
  TaskToolResult,
} from '@/agent/task/orchestrator';
import { TaskWidgetController } from '@/agent/task/widgetController';
import type { ToolCtx } from '@/tools/types';

function makeCtx(thread = 't1', signal: AbortSignal = new AbortController().signal): ToolCtx {
  return {
    thread,
    signal,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vault: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    editor: {} as any,
  };
}

function stubHandle(
  runId: string,
  threadId: string,
  terminal: Promise<TaskToolResult>,
): TaskRunHandle {
  const controller = new TaskWidgetController({ runId, threadId, prompt: 'p' });
  return {
    runId,
    threadId,
    subThreadId: `${threadId}:task:${runId}`,
    controller,
    terminal,
    state: () => controller,
    cancel: () => undefined,
    extendTimeout: () => ({ ok: false, reason: 'terminated' }),
    currentDeadlineMs: () => null,
  };
}

interface StubOrchestratorOpts {
  readonly busy?: boolean;
  readonly terminal?: Promise<TaskToolResult>;
  readonly onCancel?: () => void;
}

function makeOrchestrator(opts: StubOrchestratorOpts = {}): {
  orchestrator: TaskOrchestrator;
  startedWith: { args: unknown }[];
} {
  const startedWith: { args: unknown }[] = [];
  const orch = {
    start(input: unknown): TaskOrchestratorStartResult {
      startedWith.push({ args: input });
      if (opts.busy === true) {
        return { ok: false, busy: true, activeRunIds: ['task-other'] };
      }
      const terminal =
        opts.terminal ??
        Promise.resolve({
          ok: true,
          runId: 'task-r',
          summary: 'done',
          toolCallsCount: 1,
          durationMs: 10,
          error: null,
        } satisfies TaskToolResult);
      const handle = stubHandle('task-r', 't1', terminal);
      if (opts.onCancel !== undefined) {
        const original = handle.cancel;
        const orig = original.bind(handle);
        (handle as { cancel: () => void }).cancel = (): void => {
          opts.onCancel!();
          orig();
        };
      }
      return { ok: true, handle };
    },
    liveHandlesSnapshot(): readonly TaskRunHandle[] {
      return [];
    },
    findHandle(): null {
      return null;
    },
  };
  return { orchestrator: orch as unknown as TaskOrchestrator, startedWith };
}

describe('task tool', () => {
  it('schema rejects empty prompt', () => {
    const { orchestrator } = makeOrchestrator();
    const tool = createTaskTool({ orchestrator, confirmation: new ConfirmationController() });
    expect(tool.validate({ prompt: '' }).ok).toBe(false);
  });

  it('schema rejects prompt above 16 KB', () => {
    const { orchestrator } = makeOrchestrator();
    const tool = createTaskTool({ orchestrator, confirmation: new ConfirmationController() });
    expect(tool.validate({ prompt: 'x'.repeat(20_000) }).ok).toBe(false);
  });

  it('schema rejects timeoutMs above 30 minutes', () => {
    const { orchestrator } = makeOrchestrator();
    const tool = createTaskTool({ orchestrator, confirmation: new ConfirmationController() });
    expect(tool.validate({ prompt: 'p', timeoutMs: 30 * 60_000 + 1 }).ok).toBe(false);
  });

  it('declares requiresConfirmation: false (per-call gate inside invoke)', () => {
    const { orchestrator } = makeOrchestrator();
    const tool = createTaskTool({ orchestrator, confirmation: new ConfirmationController() });
    expect(tool.requiresConfirmation).toBe(false);
    expect(tool.shouldDefer).toBe(false);
    expect(tool.id).toBe(TASK_TOOL_ID);
  });

  it('deny path returns structured denied payload', async () => {
    const { orchestrator, startedWith } = makeOrchestrator();
    const confirmation = new ConfirmationController();
    const tool = createTaskTool({ orchestrator, confirmation });
    const p = tool.invoke({ prompt: 'find X' }, makeCtx());
    await new Promise((r) => setImmediate(r));
    confirmation.resolve('deny');
    const result = await p;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.ok).toBe(false);
    expect(result.data.error?.code).toBe('denied');
    expect(startedWith.length).toBe(0);
  });

  it('busy path returns structured busy payload without awaiting terminal', async () => {
    const { orchestrator } = makeOrchestrator({ busy: true });
    const confirmation = new ConfirmationController();
    const tool = createTaskTool({ orchestrator, confirmation });
    const p = tool.invoke({ prompt: 'find X' }, makeCtx());
    await new Promise((r) => setImmediate(r));
    confirmation.resolve('allow-once');
    const result = await p;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.ok).toBe(false);
    expect(result.data.error?.code).toBe('busy');
  });

  it('allow path awaits terminal and returns it as data', async () => {
    const terminal: TaskToolResult = {
      ok: true,
      runId: 'task-r',
      summary: 'final answer',
      toolCallsCount: 4,
      durationMs: 1234,
      error: null,
    };
    const { orchestrator } = makeOrchestrator({ terminal: Promise.resolve(terminal) });
    const confirmation = new ConfirmationController();
    const onHandle = vi.fn();
    const tool = createTaskTool({ orchestrator, confirmation, onHandle });
    const p = tool.invoke({ prompt: 'find X' }, makeCtx());
    await new Promise((r) => setImmediate(r));
    confirmation.resolve('allow-once');
    const result = await p;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual(terminal);
    expect(onHandle).toHaveBeenCalledTimes(1);
  });

  it('confirmation request uses custom action labels + disableAllowForThread=true', async () => {
    const { orchestrator } = makeOrchestrator();
    const confirmation = new ConfirmationController();
    const tool = createTaskTool({ orchestrator, confirmation });
    const p = tool.invoke({ prompt: 'X' }, makeCtx());
    await new Promise((r) => setImmediate(r));
    const pending = confirmation.current();
    expect(pending).not.toBeNull();
    if (pending === null) return;
    expect(pending.request.toolId).toBe(TASK_TOOL_ID);
    expect(pending.request.actionLabels?.allow).toBe('Spawn subagent');
    expect(pending.request.actionLabels?.deny).toBe('Deny');
    expect(pending.request.disableAllowForThread).toBe(true);
    confirmation.resolve('deny');
    await p;
  });

  it('ctx.signal abort cancels the handle', async () => {
    let cancelled = false;
    const { orchestrator } = makeOrchestrator({
      terminal: new Promise<TaskToolResult>(() => {
        /* never resolves */
      }),
      onCancel: () => {
        cancelled = true;
      },
    });
    const confirmation = new ConfirmationController();
    const tool = createTaskTool({ orchestrator, confirmation });
    const ac = new AbortController();
    const p = tool.invoke({ prompt: 'X' }, makeCtx('t1', ac.signal));
    await new Promise((r) => setImmediate(r));
    confirmation.resolve('allow-once');
    await new Promise((r) => setImmediate(r));
    ac.abort();
    expect(cancelled).toBe(true);
    // p never resolves because terminal never resolves — abandon
    void p;
  });
});
