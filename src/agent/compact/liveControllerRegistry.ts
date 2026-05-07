export interface CompactWidgetControllerLike {
  dispose?(): void;
}

const live = new Map<string, CompactWidgetControllerLike>();

export function registerCompactLiveController(
  runId: string,
  controller: CompactWidgetControllerLike,
): void {
  live.set(runId, controller);
}

export function releaseCompactLiveController(runId: string): void {
  const c = live.get(runId);
  if (c === undefined) return;
  try {
    c.dispose?.();
  } catch {
    /* dispose failure non-fatal */
  }
  live.delete(runId);
}

export function lookupCompactLiveController(runId: string): CompactWidgetControllerLike | null {
  return live.get(runId) ?? null;
}

export function compactLiveControllerCount(): number {
  return live.size;
}

export function clearCompactLiveControllers(): void {
  for (const runId of [...live.keys()]) releaseCompactLiveController(runId);
}

export const COMPACT_LIVE_KIND = 'compact_live';

export interface CompactLiveProps {
  readonly runId: string;
  readonly threadId: string;
  readonly trigger: 'manual' | 'auto';
}
