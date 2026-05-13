export interface TaskWidgetControllerLike {
  dispose?(): void;
}

const live = new Map<string, TaskWidgetControllerLike>();

export function registerTaskLiveController(
  runId: string,
  controller: TaskWidgetControllerLike,
): void {
  live.set(runId, controller);
}

export function releaseTaskLiveController(runId: string): void {
  const c = live.get(runId);
  if (c === undefined) return;
  try {
    c.dispose?.();
  } catch {
    /* dispose failure non-fatal */
  }
  live.delete(runId);
}

export function lookupTaskLiveController(runId: string): TaskWidgetControllerLike | null {
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
