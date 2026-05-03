/**
 * Explicit FIFO semaphore. Replaces ad-hoc `Promise.all` for concurrency caps
 * (NFR-WIKI-08). Acquire returns a release function — caller must release in
 * a `finally` block to keep the slot from leaking.
 */
export interface Semaphore {
  acquire(signal?: AbortSignal): Promise<() => void>;
  inFlight(): number;
  pending(): number;
}

export interface SemaphoreOptions {
  readonly maxConcurrency: number;
}

export function createSemaphore(opts: SemaphoreOptions): Semaphore {
  if (!Number.isInteger(opts.maxConcurrency) || opts.maxConcurrency < 1) {
    throw new Error(`semaphore maxConcurrency must be ≥ 1; got ${opts.maxConcurrency}`);
  }
  const max = opts.maxConcurrency;
  let active = 0;
  const waiters: Array<{
    resolve: () => void;
    reject: (err: Error) => void;
    onAbort?: () => void;
    signal?: AbortSignal;
  }> = [];

  const tryAdvance = (): void => {
    while (active < max && waiters.length > 0) {
      const next = waiters.shift()!;
      if (next.signal?.aborted === true) {
        next.reject(new DOMException('aborted', 'AbortError'));
        continue;
      }
      if (next.onAbort !== undefined && next.signal !== undefined) {
        next.signal.removeEventListener('abort', next.onAbort);
      }
      active += 1;
      next.resolve();
    }
  };

  const release = (): void => {
    active -= 1;
    tryAdvance();
  };

  return {
    async acquire(signal?: AbortSignal): Promise<() => void> {
      if (signal?.aborted === true) {
        throw new DOMException('aborted', 'AbortError');
      }
      if (active < max) {
        active += 1;
        return release;
      }
      return new Promise<void>((resolve, reject) => {
        const waiter: {
          resolve: () => void;
          reject: (err: Error) => void;
          onAbort?: () => void;
          signal?: AbortSignal;
        } = { resolve, reject };
        if (signal !== undefined) {
          waiter.signal = signal;
          waiter.onAbort = (): void => {
            const idx = waiters.indexOf(waiter);
            if (idx >= 0) waiters.splice(idx, 1);
            reject(new DOMException('aborted', 'AbortError'));
          };
          signal.addEventListener('abort', waiter.onAbort);
        }
        waiters.push(waiter);
      }).then(() => release);
    },
    inFlight: () => active,
    pending: () => waiters.length,
  };
}
