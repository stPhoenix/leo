export interface ScrollMetrics {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

const BOTTOM_TOLERANCE_PX = 16;

export function isNearBottom(m: ScrollMetrics, tolerance: number = BOTTOM_TOLERANCE_PX): boolean {
  const distance = m.scrollHeight - (m.scrollTop + m.clientHeight);
  return distance <= tolerance;
}

export function shouldAutoScroll(prevMetrics: ScrollMetrics | null): boolean {
  if (prevMetrics === null) return true;
  return isNearBottom(prevMetrics);
}
