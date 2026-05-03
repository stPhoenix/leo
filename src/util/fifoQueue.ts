/**
 * Promise-chain FIFO queue — preserves enqueue order with O(1) tail append.
 * Not built on `createSemaphore({maxConcurrency:1})` because callers do not need
 * abort-cancel of queued slots (provider streams use AbortController on the
 * underlying request, not on the queue position).
 */
export class FifoQueue {
  private tail: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.tail;
    this.tail = next;
    await prev;
    return release;
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    return this.acquire().then(async (release) => {
      try {
        return await task();
      } finally {
        release();
      }
    });
  }
}
