export type WikiOp = 'ingest' | 'lint';

export type WikiMutexState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy'; readonly op: WikiOp; readonly runId: string };

export const WIKI_MUTEX_IDLE: WikiMutexState = { kind: 'idle' };

export interface WikiMutexLike {
  active(): WikiMutexState;
}
