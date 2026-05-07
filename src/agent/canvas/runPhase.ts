import type { CanvasTerminalState } from './state';
import type { Insights } from './schemas';

export type CanvasToolResult =
  | {
      readonly ok: true;
      readonly runId: string;
      readonly path: string;
      readonly insights?: Insights;
      readonly partial?: CanvasTerminalState['partial'];
      readonly durationMs: number;
    }
  | {
      readonly ok: false;
      readonly denied: true;
    }
  | {
      readonly ok: false;
      readonly cancelled: true;
      readonly phase: string;
      readonly partial?: CanvasTerminalState['partial'];
      readonly runId: string;
      readonly path: string;
    }
  | {
      readonly ok: false;
      readonly error: { readonly code: string; readonly message: string };
      readonly runId?: string;
      readonly path?: string;
      readonly partial?: CanvasTerminalState['partial'];
      readonly activeRunId?: string;
      readonly activeOp?: string;
    };

export function buildCanvasToolResult(terminal: CanvasTerminalState): CanvasToolResult {
  if (terminal.phase === 'done') {
    const result: CanvasToolResult = {
      ok: true,
      runId: terminal.runId,
      path: terminal.path,
      durationMs: terminal.durationMs,
      ...(terminal.insights !== undefined ? { insights: terminal.insights } : {}),
      ...(terminal.partial !== undefined ? { partial: terminal.partial } : {}),
    };
    return result;
  }
  if (terminal.phase === 'cancelled') {
    return {
      ok: false,
      cancelled: true,
      phase: terminal.phase,
      runId: terminal.runId,
      path: terminal.path,
      ...(terminal.partial !== undefined ? { partial: terminal.partial } : {}),
    };
  }
  const err = terminal.error ?? { code: 'unknown', message: 'unspecified canvas error' };
  return {
    ok: false,
    error: { code: err.code, message: err.message },
    runId: terminal.runId,
    path: terminal.path,
    ...(terminal.partial !== undefined ? { partial: terminal.partial } : {}),
  };
}

export function buildBusyToolResult(busy: {
  readonly activeRunId: string;
  readonly activeOp: string;
}): CanvasToolResult {
  return {
    ok: false,
    error: {
      code: 'busy',
      message: `canvas slot busy: activeRunId=${busy.activeRunId}, activeOp=${busy.activeOp}`,
    },
    activeRunId: busy.activeRunId,
    activeOp: busy.activeOp,
  };
}

export function buildDeniedToolResult(): CanvasToolResult {
  return { ok: false, denied: true };
}
