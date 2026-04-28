import { describe, expect, it } from 'vitest';
import { PlanModeController } from '@/agent/planModeController';
import { TodoStore } from '@/agent/todoStore';
import { makePlanModeSource } from '@/ui/chat/planModeSource';

describe('makePlanModeSource', () => {
  it('getMode reads the controller for the active thread', () => {
    const controller = new PlanModeController({ todoStore: new TodoStore() });
    let active = 't-a';
    const source = makePlanModeSource(controller, () => active);
    expect(source.getMode()).toBe('normal');
    controller.enterPlan('t-a', '.leo/plans/x-y.md');
    expect(source.getMode()).toBe('plan');
    active = 't-b';
    expect(source.getMode()).toBe('normal');
  });

  it('subscribe forwards to the controller; unsubscribe removes the listener', () => {
    const controller = new PlanModeController({ todoStore: new TodoStore() });
    const source = makePlanModeSource(controller, () => 't-a');
    let calls = 0;
    const off = source.subscribe(() => {
      calls += 1;
    });
    controller.enterPlan('t-a', '.leo/plans/x-y.md');
    expect(calls).toBe(1);
    off();
    controller.exitPlan('t-a');
    expect(calls).toBe(1);
  });
});
