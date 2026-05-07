import type { ConfirmationController } from '@/agent/confirmationController';
import { prettifyArgs } from '@/agent/confirmationController';
import type { ToolCtx, ToolResult } from '@/tools/types';
import type { CanvasOrchestrator } from '../orchestrator';
import type { StartCanvasInput } from '../subgraph';
import {
  buildBusyToolResult,
  buildCanvasToolResult,
  buildDeniedToolResult,
  type CanvasToolResult,
} from '../runPhase';

export interface CanvasConfirmFlowOptions {
  readonly toolId: string;
  readonly orchestrator: CanvasOrchestrator;
  readonly confirmation: ConfirmationController;
  readonly ctx: ToolCtx;
  readonly args: unknown;
  readonly allowLabel: string;
  readonly buildStartInput: () =>
    | { readonly ok: true; readonly input: StartCanvasInput }
    | { readonly ok: false; readonly error: { code: string; message: string } }
    | Promise<
        | { readonly ok: true; readonly input: StartCanvasInput }
        | { readonly ok: false; readonly error: { code: string; message: string } }
      >;
}

export async function runCanvasConfirmFlow(
  opts: CanvasConfirmFlowOptions,
): Promise<ToolResult<CanvasToolResult>> {
  const { ctx, confirmation, orchestrator, toolId, allowLabel } = opts;
  const argsJson = JSON.stringify(opts.args);
  const decision = await confirmation.request({
    toolId,
    thread: ctx.thread,
    argsJson,
    argsPretty: prettifyArgs(argsJson),
    category: 'write',
    actionLabels: { allow: allowLabel, deny: 'Deny' },
    disableAllowForThread: true,
  });
  if (decision === 'deny') {
    ctx.logger?.info('canvas.delegate.denied', { thread: ctx.thread, toolId });
    return { ok: true, data: buildDeniedToolResult() };
  }

  const startInput = await Promise.resolve(opts.buildStartInput());
  if (!startInput.ok) {
    ctx.logger?.warn('canvas.delegate.preflight.failed', {
      thread: ctx.thread,
      toolId,
      code: startInput.error.code,
    });
    return {
      ok: true,
      data: { ok: false, error: startInput.error },
    };
  }

  const start = await orchestrator.start(startInput.input);
  if (!start.ok) {
    if ('cancelledByPicker' in start) {
      ctx.logger?.info('canvas.delegate.cancelled-by-picker', {
        thread: ctx.thread,
        toolId,
      });
      return { ok: true, data: buildDeniedToolResult() };
    }
    ctx.logger?.info('canvas.delegate.busy', {
      thread: ctx.thread,
      toolId,
      activeRunId: start.busy.activeRunId,
      activeOp: start.busy.activeOp,
    });
    return { ok: true, data: buildBusyToolResult(start.busy) };
  }

  const onAbort = (): void => {
    ctx.logger?.warn('canvas.delegate.ctxSignal.aborted', {
      thread: ctx.thread,
      toolId,
      runId: start.handle.runId,
    });
    start.handle.abort();
  };
  ctx.signal.addEventListener('abort', onAbort, { once: true });
  try {
    const terminal = await start.terminal;
    return { ok: true, data: buildCanvasToolResult(terminal) };
  } finally {
    ctx.signal.removeEventListener('abort', onAbort);
  }
}
