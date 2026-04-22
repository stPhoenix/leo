export interface DebouncedFn<T extends unknown[]> {
  (...args: T): void;
  flush(): void;
  cancel(): void;
  pending(): boolean;
}

export function debounce<T extends unknown[]>(
  fn: (...args: T) => void,
  waitMs: number,
): DebouncedFn<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: T | null = null;

  const invoke = (): void => {
    timer = null;
    if (lastArgs === null) return;
    const args = lastArgs;
    lastArgs = null;
    fn(...args);
  };

  const debounced = ((...args: T) => {
    lastArgs = args;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(invoke, waitMs);
  }) as DebouncedFn<T>;

  debounced.flush = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    invoke();
  };

  debounced.cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };

  debounced.pending = (): boolean => timer !== null;

  return debounced;
}
