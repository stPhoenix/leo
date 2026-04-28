import type { Logger } from '@/platform/Logger';

export interface ContextCommandDeps<TData = unknown> {
  readonly analyze: (signal: AbortSignal) => Promise<TData>;
  readonly render: (data: TData) => void;
  readonly onError: (err: Error) => void;
  readonly logger?: Logger;
}

export interface ContextCommandHandle {
  invoke: () => Promise<void>;
  cancel: () => void;
}

export function createContextCommand<TData>(deps: ContextCommandDeps<TData>): ContextCommandHandle {
  let current: AbortController | null = null;

  const invoke = async (): Promise<void> => {
    current?.abort();
    const controller = new AbortController();
    current = controller;
    try {
      const data = await deps.analyze(controller.signal);
      if (controller.signal.aborted) return;
      deps.render(data);
    } catch (err) {
      if (controller.signal.aborted) return;
      const error = err instanceof Error ? err : new Error(String(err));
      deps.logger?.warn('context.command.failed', { error: error.message });
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

export const CONTEXT_SLASH_COMMAND_REGEX = /^\/context\s*$/;

export function isContextSlashCommand(text: string): boolean {
  return CONTEXT_SLASH_COMMAND_REGEX.test(text);
}

export const CONTEXT_PALETTE_COMMAND_ID = 'leo-show-context';
export const CONTEXT_PALETTE_COMMAND_NAME = 'Leo: Show context';
