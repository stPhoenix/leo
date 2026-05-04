export interface WikiWidgetControllerLike {
  dispose?(): void;
}

const live = new Map<string, WikiWidgetControllerLike>();

export function registerWikiLiveController(
  runId: string,
  controller: WikiWidgetControllerLike,
): void {
  live.set(runId, controller);
}

export function releaseWikiLiveController(runId: string): void {
  const c = live.get(runId);
  if (c === undefined) return;
  try {
    c.dispose?.();
  } catch {
    /* dispose failure non-fatal */
  }
  live.delete(runId);
}

export function lookupWikiLiveController(runId: string): WikiWidgetControllerLike | null {
  return live.get(runId) ?? null;
}

export function wikiLiveControllerCount(): number {
  return live.size;
}

export function clearWikiLiveControllers(): void {
  for (const runId of [...live.keys()]) releaseWikiLiveController(runId);
}

export const WIKI_LIVE_KIND = 'wiki_live';

export interface WikiLiveProps {
  readonly runId: string;
  readonly threadId: string;
}
