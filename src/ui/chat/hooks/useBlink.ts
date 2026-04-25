import { useEffect, useState } from 'react';

export interface UseBlinkOptions {
  readonly intervalMs?: number;
  readonly setInterval?: (cb: () => void, ms: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
}

const defaultIntervalSet = (cb: () => void, ms: number): unknown => globalThis.setInterval(cb, ms);
const defaultIntervalClear = (h: unknown): void => {
  globalThis.clearInterval(h as ReturnType<typeof setInterval>);
};

export function useBlink(active: boolean, opts: UseBlinkOptions = {}): boolean {
  const [on, setOn] = useState<boolean>(true);
  const intervalMs = opts.intervalMs ?? 500;
  const set = opts.setInterval ?? defaultIntervalSet;
  const clear = opts.clearInterval ?? defaultIntervalClear;

  useEffect(() => {
    if (!active) {
      setOn(true);
      return;
    }
    const handle = set(() => {
      setOn((prev) => !prev);
    }, intervalMs);
    return () => {
      clear(handle);
    };
  }, [active, intervalMs, set, clear]);

  if (!active) return false;
  return on;
}
