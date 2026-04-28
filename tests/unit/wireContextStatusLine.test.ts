import { describe, expect, it, vi } from 'vitest';
import {
  wireContextStatusLine,
  formatStatusLine,
  type ContextStatusLineElement,
} from '@/ui/wireContextStatusLine';
import type { StatusLineContext } from '@/ui/contextSuggestions';

function mkEl(): ContextStatusLineElement & {
  last: string;
  detached: boolean;
  setTextCalls: number;
} {
  const el = {
    last: '',
    detached: false,
    setTextCalls: 0,
    setText(text: string) {
      this.last = text;
      this.setTextCalls += 1;
    },
    detach() {
      this.detached = true;
    },
  };
  return el;
}

const ctx: StatusLineContext = {
  total_input_tokens: 4_800,
  total_output_tokens: 0,
  context_window_size: 16_000,
  current_usage: 4_800,
  used_percentage: 30,
  remaining_percentage: 70,
};

describe('wireContextStatusLine', () => {
  it('formatStatusLine renders tokens/budget and remaining %', () => {
    expect(formatStatusLine(ctx)).toBe('Leo: 4800/16000 — 70% free');
  });

  it('trigger() debounces write + re-exports suggestion helpers', () => {
    const el = mkEl();
    let nextCtx: StatusLineContext | null = ctx;
    const timers = new Map<number, () => void>();
    let id = 0;
    const setTimeoutFn = ((fn: () => void, _ms?: number) => {
      id += 1;
      timers.set(id, fn);
      return id as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    const clearTimeoutFn = ((handle: unknown) => {
      timers.delete(handle as number);
    }) as unknown as typeof clearTimeout;

    const w = wireContextStatusLine({
      createStatusEl: () => el,
      build: () => nextCtx,
      setTimeoutFn,
      clearTimeoutFn,
    });
    w.trigger();
    w.trigger();
    expect(timers.size).toBe(1);
    expect(el.setTextCalls).toBe(0);
    const fire = [...timers.values()][0]!;
    fire();
    expect(el.last).toBe('Leo: 4800/16000 — 70% free');

    nextCtx = null;
    w.trigger();
    const fire2 = [...timers.values()].pop()!;
    fire2();
    expect(el.last).toBe('');

    expect(typeof w.generateContextSuggestions).toBe('function');
    expect(typeof w.sortSuggestions).toBe('function');
    expect(typeof w.buildStatusLineContext).toBe('function');
  });

  it('dispose() halts future writes and detaches the status element; is idempotent', () => {
    const el = mkEl();
    const timers: Array<() => void> = [];
    const setTimeoutFn = ((fn: () => void) => {
      timers.push(fn);
      return timers.length as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    const clearTimeoutFn = (() => undefined) as unknown as typeof clearTimeout;
    const spy = vi.fn(() => ctx);

    const w = wireContextStatusLine({
      createStatusEl: () => el,
      build: spy,
      setTimeoutFn,
      clearTimeoutFn,
    });
    w.trigger();
    w.dispose();
    w.dispose();
    timers[0]!();
    expect(spy).not.toHaveBeenCalled();
    expect(el.detached).toBe(true);
  });
});
