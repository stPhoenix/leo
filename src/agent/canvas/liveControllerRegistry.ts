export interface CanvasWidgetControllerLike {
  dispose?(): void;
}

const live = new Map<string, CanvasWidgetControllerLike>();

export function registerCanvasLiveController(
  runId: string,
  controller: CanvasWidgetControllerLike,
): void {
  live.set(runId, controller);
}

export function releaseCanvasLiveController(runId: string): void {
  const c = live.get(runId);
  if (c === undefined) return;
  try {
    c.dispose?.();
  } catch {
    /* dispose failure non-fatal */
  }
  live.delete(runId);
}

export function lookupCanvasLiveController(runId: string): CanvasWidgetControllerLike | null {
  return live.get(runId) ?? null;
}

export function canvasLiveControllerCount(): number {
  return live.size;
}

export function clearCanvasLiveControllers(): void {
  for (const runId of [...live.keys()]) releaseCanvasLiveController(runId);
}

export const CANVAS_LIVE_KIND = 'canvas_live';

export interface CanvasLiveProps {
  readonly runId: string;
  readonly threadId: string;
}
