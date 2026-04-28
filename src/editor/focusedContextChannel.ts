import { NULL_FOCUSED_CONTEXT, type FocusedContext, type FocusedContextSink } from './types';

export type FocusedContextListener = (ctx: FocusedContext) => void;

export class FocusedContextChannel implements FocusedContextSink {
  private latest: FocusedContext = NULL_FOCUSED_CONTEXT;
  private readonly listeners = new Set<FocusedContextListener>();

  push(ctx: FocusedContext): void {
    this.latest = ctx;
    for (const listener of this.listeners) listener(ctx);
  }

  current(): FocusedContext {
    return this.latest;
  }

  subscribe(listener: FocusedContextListener): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }
}
