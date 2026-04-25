// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useBlink } from '@/ui/chat/hooks/useBlink';

afterEach(() => {
  // happy-dom timers reset between cases via React renderHook's unmount cleanup.
});

describe('useBlink (F04 AC2)', () => {
  it('returns false when inactive', () => {
    const { result } = renderHook(() => useBlink(false));
    expect(result.current).toBe(false);
  });

  it('toggles between true and false on the configured interval', async () => {
    let nowOn: (() => void) | null = null;
    const fakeSet = (cb: () => void): unknown => {
      nowOn = cb;
      return 1;
    };
    const fakeClear = (): void => undefined;
    const { result, rerender } = renderHook((active: boolean) =>
      useBlink(active, { intervalMs: 100, setInterval: fakeSet, clearInterval: fakeClear }),
    );
    rerender(true);
    expect(result.current).toBe(true);
    act(() => nowOn?.());
    expect(result.current).toBe(false);
    act(() => nowOn?.());
    expect(result.current).toBe(true);
  });

  it('clears interval on unmount', () => {
    let cleared = 0;
    const fakeSet = (): unknown => 'h';
    const fakeClear = (): void => {
      cleared += 1;
    };
    const { unmount } = renderHook(() =>
      useBlink(true, { intervalMs: 100, setInterval: fakeSet, clearInterval: fakeClear }),
    );
    unmount();
    expect(cleared).toBe(1);
  });

  it('clears interval when active flips false', () => {
    let cleared = 0;
    const fakeSet = (): unknown => 'h';
    const fakeClear = (): void => {
      cleared += 1;
    };
    const { rerender } = renderHook((active: boolean) =>
      useBlink(active, { intervalMs: 100, setInterval: fakeSet, clearInterval: fakeClear }),
    );
    rerender(true);
    rerender(false);
    expect(cleared).toBe(1);
  });
});
