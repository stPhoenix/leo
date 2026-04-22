import {
  buildStatusLineContext,
  createDebouncedStatusLineUpdater,
  generateContextSuggestions,
  sortSuggestions,
  type StatusLineContext,
  type StatusLineUpdater,
} from './contextSuggestions';

export type { StatusLineContext, StatusLineUpdater } from './contextSuggestions';

export interface ContextStatusLineElement {
  setText(text: string): void;
  detach(): void;
}

export interface WireContextStatusLineOptions {
  readonly createStatusEl: () => ContextStatusLineElement;
  readonly build: () => StatusLineContext | null;
  readonly debounceMs?: number;
  readonly setTimeoutFn?: typeof setTimeout;
  readonly clearTimeoutFn?: typeof clearTimeout;
  readonly onError?: (err: Error) => void;
}

export interface ContextStatusLineWiring {
  readonly statusEl: ContextStatusLineElement;
  trigger(): void;
  generateContextSuggestions: typeof generateContextSuggestions;
  sortSuggestions: typeof sortSuggestions;
  buildStatusLineContext: typeof buildStatusLineContext;
  dispose(): void;
}

export function wireContextStatusLine(opts: WireContextStatusLineOptions): ContextStatusLineWiring {
  const statusEl = opts.createStatusEl();
  const write = (ctx: StatusLineContext | null): void => {
    if (ctx === null) {
      statusEl.setText('');
      return;
    }
    statusEl.setText(formatStatusLine(ctx));
  };
  const updater: StatusLineUpdater = createDebouncedStatusLineUpdater({
    build: opts.build,
    write,
    ...(opts.debounceMs !== undefined ? { debounceMs: opts.debounceMs } : {}),
    ...(opts.setTimeoutFn !== undefined ? { setTimeoutFn: opts.setTimeoutFn } : {}),
    ...(opts.clearTimeoutFn !== undefined ? { clearTimeoutFn: opts.clearTimeoutFn } : {}),
    ...(opts.onError !== undefined ? { onError: opts.onError } : {}),
  });
  let disposed = false;
  return {
    statusEl,
    trigger: () => updater.trigger(),
    generateContextSuggestions,
    sortSuggestions,
    buildStatusLineContext,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      updater.dispose();
      statusEl.detach();
    },
  };
}

export function formatStatusLine(ctx: StatusLineContext): string {
  const pct = ctx.remaining_percentage.toFixed(0);
  return `Leo: ${ctx.current_usage}/${ctx.context_window_size} — ${pct}% free`;
}
