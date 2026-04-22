import { describe, expect, it } from 'vitest';
import { isCollapsed } from '@/ui/responsiveCollapse';
import { COLLAPSE_THRESHOLD_PX } from '@/ui/viewType';

describe('isCollapsed', () => {
  it('returns false at exactly the threshold', () => {
    expect(isCollapsed(COLLAPSE_THRESHOLD_PX)).toBe(false);
  });

  it('returns true just below the threshold', () => {
    expect(isCollapsed(COLLAPSE_THRESHOLD_PX - 1)).toBe(true);
  });

  it('returns false just above the threshold', () => {
    expect(isCollapsed(COLLAPSE_THRESHOLD_PX + 1)).toBe(false);
  });

  it('returns false when width is 0 (pre-mount sentinel)', () => {
    expect(isCollapsed(0)).toBe(false);
  });

  it('respects custom thresholds', () => {
    expect(isCollapsed(150, 200)).toBe(true);
    expect(isCollapsed(250, 200)).toBe(false);
  });
});
