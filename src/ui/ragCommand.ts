import type { Logger } from '@/platform/Logger';
import type { RagSnapshot } from '@/rag/ragSnapshot';

export interface RagCommandDeps {
  readonly collect: (signal: AbortSignal) => Promise<RagSnapshot>;
  readonly render: (snapshot: RagSnapshot) => void;
  readonly onError: (err: Error) => void;
  readonly logger?: Logger;
}

export interface RagCommandHandle {
  invoke: () => Promise<void>;
  cancel: () => void;
}

export function createRagCommand(deps: RagCommandDeps): RagCommandHandle {
  let current: AbortController | null = null;

  const invoke = async (): Promise<void> => {
    current?.abort();
    const controller = new AbortController();
    current = controller;
    try {
      deps.logger?.info('rag.command.invoke', {});
      const snapshot = await deps.collect(controller.signal);
      if (controller.signal.aborted) return;
      deps.render(snapshot);
    } catch (err) {
      if (controller.signal.aborted) return;
      const error = err instanceof Error ? err : new Error(String(err));
      deps.logger?.warn('rag.command.failed', { error: error.message });
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

export const RAG_SLASH_COMMAND_REGEX = /^\/rag\s*$/;

export function isRagSlashCommand(text: string): boolean {
  return RAG_SLASH_COMMAND_REGEX.test(text);
}

export const RAG_PALETTE_COMMAND_ID = 'leo-show-rag';
export const RAG_PALETTE_COMMAND_NAME = 'Leo: Show RAG status';
