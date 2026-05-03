/**
 * Cancellable delay — resolves after `ms`, rejects with `signal.reason` on abort.
 * Not replaced by `AbortSignal.timeout(ms)` because that fires *resolve* on timeout
 * (the opposite shape); every retry-loop caller relies on the abort-rejects-with-reason
 * semantics here. Migration would touch every back-off/poll site.
 */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('aborted'));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = (): void => {
      cleanup();
      reject(signal?.reason ?? new Error('aborted'));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort);
  });
}
