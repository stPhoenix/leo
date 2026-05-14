import type { TaskExtendTimeoutResult } from './orchestrator';

export interface TaskWidgetControllerLike {
  dispose?(): void;
}

/**
 * Structural subset of `TaskRunHandle` the UI needs to extend a live run.
 * Defined here (not imported from orchestrator) so the registry stays a leaf
 * module and the UI doesn't depend on orchestrator internals.
 */
export interface TaskLiveHandleLike {
  extendTimeout(additionalMs: number): TaskExtendTimeoutResult;
  currentDeadlineMs(): number | null;
}

export interface TaskLiveEntry {
  readonly controller: TaskWidgetControllerLike;
  readonly handle: TaskLiveHandleLike | null;
}

const live = new Map<string, TaskLiveEntry>();

export function registerTaskLiveController(
  runId: string,
  controller: TaskWidgetControllerLike,
  handle: TaskLiveHandleLike | null = null,
): void {
  live.set(runId, { controller, handle });
}

export function releaseTaskLiveController(runId: string): void {
  const entry = live.get(runId);
  if (entry === undefined) return;
  try {
    entry.controller.dispose?.();
  } catch {
    /* dispose failure non-fatal */
  }
  live.delete(runId);
}

export function lookupTaskLiveController(runId: string): TaskLiveEntry | null {
  return live.get(runId) ?? null;
}

export function taskLiveControllerCount(): number {
  return live.size;
}

export function clearTaskLiveControllers(): void {
  for (const runId of [...live.keys()]) releaseTaskLiveController(runId);
}

export const SUBAGENT_LIVE_KIND = 'subagent_live';
export const SUBAGENT_TERMINAL_KIND = 'subagent_terminal';

export interface SubagentLiveProps {
  readonly runId: string;
  readonly threadId: string;
  readonly prompt: string;
}
