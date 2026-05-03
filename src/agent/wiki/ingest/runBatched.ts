import type { Semaphore } from './semaphore';

/**
 * Run an async fn over a list of items under semaphore-bounded concurrency.
 * Replaces ad-hoc `Promise.all` per NFR-WIKI-08. Per-item failures do not
 * abort the batch; each item resolves independently.
 */
export async function runBatched<TItem, TResult>(
  items: readonly TItem[],
  semaphore: Semaphore,
  worker: (item: TItem, signal: AbortSignal) => Promise<TResult>,
  signal: AbortSignal,
): Promise<readonly TResult[]> {
  if (items.length === 0) return [];
  const results: TResult[] = new Array<TResult>(items.length);
  await Promise.all(
    items.map(async (item, index) => {
      let release: (() => void) | null = null;
      try {
        release = await semaphore.acquire(signal);
        if (signal.aborted) {
          throw new DOMException('aborted', 'AbortError');
        }
        results[index] = await worker(item, signal);
      } finally {
        release?.();
      }
    }),
  );
  return results;
}
