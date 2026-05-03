import type { Logger } from '@/platform/Logger';
import type { WikiStatus } from '@/agent/wiki/wikiStatus';

export interface WikiStatusCommandDeps {
  readonly collect: (signal: AbortSignal) => Promise<WikiStatus>;
  readonly render: (status: WikiStatus) => void;
  readonly onError: (err: Error) => void;
  readonly logger?: Logger;
}

export interface WikiStatusCommandHandle {
  invoke: () => Promise<void>;
  cancel: () => void;
}

export function createWikiStatusCommand(deps: WikiStatusCommandDeps): WikiStatusCommandHandle {
  let current: AbortController | null = null;

  const invoke = async (): Promise<void> => {
    current?.abort();
    const controller = new AbortController();
    current = controller;
    try {
      deps.logger?.info('wiki.status.invoke', {});
      const status = await deps.collect(controller.signal);
      if (controller.signal.aborted) return;
      deps.render(status);
    } catch (err) {
      if (controller.signal.aborted) return;
      const error = err instanceof Error ? err : new Error(String(err));
      deps.logger?.warn('wiki.status.failed', { error: error.message });
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

export const WIKI_STATUS_WIDGET_KIND = 'wiki-status';
