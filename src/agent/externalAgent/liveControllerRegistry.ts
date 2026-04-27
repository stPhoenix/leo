import type { ExternalAgentWidgetController } from './widgetController';

const live = new Map<string, ExternalAgentWidgetController>();

export function registerLiveController(
  runId: string,
  controller: ExternalAgentWidgetController,
): void {
  live.set(runId, controller);
}

export function unregisterLiveController(runId: string): void {
  const c = live.get(runId);
  if (c !== undefined) {
    try {
      c.dispose();
    } catch {
      /* dispose failure non-fatal */
    }
    live.delete(runId);
  }
}

export function lookupLiveController(runId: string): ExternalAgentWidgetController | null {
  return live.get(runId) ?? null;
}

export function liveControllerCount(): number {
  return live.size;
}

export const EXTERNAL_AGENT_LIVE_KIND = 'external_agent_live';

export interface ExternalAgentLiveProps {
  readonly runId: string;
  readonly threadId: string;
}
