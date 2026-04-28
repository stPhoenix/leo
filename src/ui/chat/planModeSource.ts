import type { PlanMode, PlanModeController } from '@/agent/planModeController';

export interface PlanModeSource {
  readonly getMode: () => PlanMode;
  readonly subscribe: (cb: () => void) => () => void;
}

export function makePlanModeSource(
  controller: PlanModeController,
  getActiveThread: () => string,
): PlanModeSource {
  return {
    getMode: () => controller.getMode(getActiveThread()),
    subscribe: (cb) => controller.subscribe(cb),
  };
}
