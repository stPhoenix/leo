import type { Logger } from '@/platform/Logger';
import type { CanvasStatus } from '@/agent/canvas/canvasStatus';

export interface CanvasStatusCommandDeps {
  readonly collect: (signal: AbortSignal) => Promise<CanvasStatus>;
  readonly render: (status: CanvasStatus) => void;
  readonly onError: (err: Error) => void;
  readonly logger?: Logger;
}

export interface CanvasStatusCommandHandle {
  invoke: () => Promise<void>;
  cancel: () => void;
}

export function createCanvasStatusCommand(
  deps: CanvasStatusCommandDeps,
): CanvasStatusCommandHandle {
  let current: AbortController | null = null;

  const invoke = async (): Promise<void> => {
    current?.abort();
    const controller = new AbortController();
    current = controller;
    try {
      deps.logger?.info('canvas.status.invoke', {});
      const status = await deps.collect(controller.signal);
      if (controller.signal.aborted) return;
      deps.render(status);
    } catch (err) {
      if (controller.signal.aborted) return;
      const error = err instanceof Error ? err : new Error(String(err));
      deps.logger?.warn('canvas.status.failed', { error: error.message });
      deps.onError(error);
    } finally {
      if (current === controller) current = null;
    }
  };

  const cancel = (): void => {
    current?.abort();
    current = null;
  };

  return { invoke, cancel };
}

export const CANVAS_STATUS_WIDGET_KIND = 'canvas-status';
