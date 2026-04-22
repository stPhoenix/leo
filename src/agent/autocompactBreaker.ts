import type { Logger } from '@/platform/Logger';
import { MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES } from './compactConstants';

export interface AutoCompactTrackingState {
  compacted: boolean;
  turnCounter: number;
  turnId: string;
  consecutiveFailures: number;
}

export interface BreakerStatusChannel {
  status(key: string, message: string): void;
  removeStatus(key: string): void;
}

export const BREAKER_STATUS_KEY = 'leo.autocompact.breaker';
export const BREAKER_STATUS_MESSAGE = 'Leo: autocompact disabled for this session';

export function createTrackingState(): AutoCompactTrackingState {
  return {
    compacted: false,
    turnCounter: 0,
    turnId: '',
    consecutiveFailures: 0,
  };
}

export function shouldSkipForCircuitBreaker(tracking: AutoCompactTrackingState): boolean {
  return tracking.consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES;
}

export interface BreakerSurfaces {
  readonly logger: Logger;
  readonly notifications?: BreakerStatusChannel;
}

export function recordFailure(tracking: AutoCompactTrackingState, surfaces: BreakerSurfaces): void {
  const wasBelow = tracking.consecutiveFailures < MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES;
  tracking.consecutiveFailures += 1;
  const nowAt = tracking.consecutiveFailures === MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES;
  if (wasBelow && nowAt) {
    surfaces.logger.warn('tengu_compact_breaker_tripped', {
      consecutiveFailures: tracking.consecutiveFailures,
    });
    surfaces.notifications?.status(BREAKER_STATUS_KEY, BREAKER_STATUS_MESSAGE);
  }
}

export function recordSuccess(tracking: AutoCompactTrackingState, surfaces: BreakerSurfaces): void {
  if (tracking.consecutiveFailures > 0) {
    tracking.consecutiveFailures = 0;
    surfaces.notifications?.removeStatus(BREAKER_STATUS_KEY);
  }
  tracking.compacted = true;
}

export function disposeBreakerSurface(
  tracking: AutoCompactTrackingState,
  surfaces: BreakerSurfaces,
): void {
  surfaces.notifications?.removeStatus(BREAKER_STATUS_KEY);
  tracking.consecutiveFailures = 0;
}
