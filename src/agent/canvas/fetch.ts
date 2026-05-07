import { fetchIngestSource, type FetchSourceDeps } from '@/agent/wiki/ingest/fetchSource';
import type { FetchedSource, IngestSource } from '@/agent/wiki/ingest/types';
import type { CanvasSourceItem } from './plan';

export type FetchedCanvasItemStatus = 'fetched' | 'error';

export interface FetchedCanvasItem {
  readonly source: CanvasSourceItem;
  readonly status: FetchedCanvasItemStatus;
  readonly fetched?: FetchedSource;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

export interface FetchCanvasSourcesResult {
  readonly items: readonly FetchedCanvasItem[];
  readonly failedAll: boolean;
}

export interface FetchCanvasSourcesDeps extends FetchSourceDeps {}

export async function fetchCanvasSources(
  items: readonly CanvasSourceItem[],
  deps: FetchCanvasSourcesDeps,
  signal: AbortSignal,
): Promise<FetchCanvasSourcesResult> {
  if (items.length === 0) {
    return { items: [], failedAll: false };
  }

  const out = await Promise.all(
    items.map(async (item): Promise<FetchedCanvasItem> => {
      try {
        const source = toIngestSource(item);
        const result = await fetchIngestSource(source, deps, signal);
        if (result.ok) {
          return { source: item, status: 'fetched', fetched: result.fetched };
        }
        return {
          source: item,
          status: 'error',
          errorCode: result.error.code,
          errorMessage: result.error.message,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const aborted = signal.aborted || /abort/i.test(message);
        return {
          source: item,
          status: 'error',
          errorCode: aborted ? 'aborted' : 'fetch_failed',
          errorMessage: message,
        };
      }
    }),
  );

  const failedAll = out.every((it) => it.status === 'error');
  return { items: out, failedAll };
}

function toIngestSource(item: CanvasSourceItem): IngestSource {
  switch (item.kind) {
    case 'url':
      return { kind: 'url', url: item.resolvedRef };
    case 'vaultPath':
      return { kind: 'vaultPath', path: item.resolvedRef };
    case 'attachment':
      return { kind: 'attachment', attachmentId: item.resolvedRef };
    case 'conversation': {
      const conv = item.conversation;
      const title = conv?.title ?? item.resolvedRef;
      const body = conv?.body ?? '';
      return {
        kind: 'conversation',
        title,
        body,
        threadId: title,
        turnIndex: 0,
      };
    }
  }
}
