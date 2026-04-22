import { COLLAPSE_THRESHOLD_PX } from './viewType';

export function isCollapsed(width: number, threshold: number = COLLAPSE_THRESHOLD_PX): boolean {
  return width > 0 && width < threshold;
}
