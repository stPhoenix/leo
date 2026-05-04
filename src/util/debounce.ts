import { debounce as obsDebounce, type Debouncer } from 'obsidian';

export interface DebouncedFn<T extends unknown[]> {
  (...args: T): void;
  flush(): void;
  cancel(): void;
  pending(): boolean;
}

// Thin wrapper over Obsidian's `debounce()`. Obsidian's `Debouncer` ships
// `cancel()` + `run()` (flush-if-pending) natively; the only API gap vs Leo's
// historical surface is `pending()`, which Obsidian doesn't expose — tracked
// here via a wrapper bool cleared in the trampoline.
export function debounce<T extends unknown[]>(
  fn: (...args: T) => void,
  waitMs: number,
): DebouncedFn<T> {
  let pendingFlag = false;
  const trampoline = (...args: T): void => {
    pendingFlag = false;
    fn(...args);
  };
  const inner: Debouncer<T, void> = obsDebounce<T, void>(trampoline, waitMs, true);
  const debounced = ((...args: T) => {
    pendingFlag = true;
    inner(...args);
  }) as DebouncedFn<T>;
  debounced.flush = (): void => {
    inner.run();
  };
  debounced.cancel = (): void => {
    inner.cancel();
    pendingFlag = false;
  };
  debounced.pending = (): boolean => pendingFlag;
  return debounced;
}
