import { describe, expect, it } from 'vitest';
import { PlanApprovalController } from '@/agent/planApprovalController';

describe('PlanApprovalController', () => {
  it('present resolves with outcome passed to resolve()', async () => {
    const c = new PlanApprovalController();
    const p = c.present({ plan: '# x', threadId: 't-1', isSubagent: false });
    c.resolve({ type: 'approve', planWasEdited: false, plan: '# x' });
    await expect(p).resolves.toEqual({ type: 'approve', planWasEdited: false, plan: '# x' });
  });

  it('current() returns pending request until resolved', () => {
    const c = new PlanApprovalController();
    expect(c.current()).toBeNull();
    void c.present({ plan: '# x', threadId: 't-1', isSubagent: false });
    expect(c.current()?.request.plan).toBe('# x');
    c.resolve({ type: 'reject' });
    expect(c.current()).toBeNull();
  });

  it('a second present() while one is pending auto-rejects the previous', async () => {
    const c = new PlanApprovalController();
    const first = c.present({ plan: 'a', threadId: 't-1', isSubagent: false });
    c.present({ plan: 'b', threadId: 't-1', isSubagent: false });
    await expect(first).resolves.toEqual({ type: 'reject' });
  });

  it('subscribe fires on each state change', () => {
    const c = new PlanApprovalController();
    let calls = 0;
    const unsub = c.subscribe(() => {
      calls += 1;
    });
    void c.present({ plan: 'a', threadId: 't-1', isSubagent: false });
    c.resolve({ type: 'reject' });
    unsub();
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('dispose force-rejects any pending request and clears listeners', async () => {
    const c = new PlanApprovalController();
    const p = c.present({ plan: 'a', threadId: 't-1', isSubagent: false });
    c.dispose();
    await expect(p).resolves.toEqual({ type: 'reject' });
    expect(c.current()).toBeNull();
  });
});
