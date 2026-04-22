import { describe, expect, it } from 'vitest';
import { isNearBottom, shouldAutoScroll } from '@/ui/chat/scrollAnchoring';

describe('isNearBottom', () => {
  it('returns true when the user is at the very bottom', () => {
    expect(isNearBottom({ scrollTop: 800, scrollHeight: 1000, clientHeight: 200 })).toBe(true);
  });

  it('returns true within the default 16 px tolerance', () => {
    expect(isNearBottom({ scrollTop: 790, scrollHeight: 1000, clientHeight: 200 })).toBe(true);
  });

  it('returns false when scrolled meaningfully up', () => {
    expect(isNearBottom({ scrollTop: 600, scrollHeight: 1000, clientHeight: 200 })).toBe(false);
  });

  it('respects a custom tolerance', () => {
    expect(isNearBottom({ scrollTop: 600, scrollHeight: 1000, clientHeight: 200 }, 250)).toBe(true);
  });
});

describe('shouldAutoScroll', () => {
  it('auto-scrolls on first paint (no previous metrics)', () => {
    expect(shouldAutoScroll(null)).toBe(true);
  });

  it('auto-scrolls when previously near bottom', () => {
    expect(shouldAutoScroll({ scrollTop: 800, scrollHeight: 1000, clientHeight: 200 })).toBe(true);
  });

  it('preserves position when previously scrolled up', () => {
    expect(shouldAutoScroll({ scrollTop: 100, scrollHeight: 1000, clientHeight: 200 })).toBe(false);
  });
});
