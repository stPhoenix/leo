import { describe, expect, it } from 'vitest';
import { makeToolCtx } from './_toolCtx';
import { PlanModeController } from '@/agent/planModeController';
import { PlanApprovalController } from '@/agent/planApprovalController';
import { TodoStore } from '@/agent/todoStore';
import { PlanStore } from '@/storage/planStore';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import {
  PLAN_APPROVAL_CASE_2_MESSAGE,
  PLAN_APPROVAL_CASE_3_MESSAGE,
  createEnterPlanModeTool,
  createExitPlanModeTool,
} from '@/tools/planModeTools';
import type { ToolCtx } from '@/tools/types';

class FakeVault implements VaultAdapter {
  readonly files = new Map<string, string>();
  async exists(p: string): Promise<boolean> {
    return this.files.has(p);
  }
  async mkdir(): Promise<void> {
    /* no-op */
  }
  async read(p: string): Promise<string> {
    const v = this.files.get(p);
    if (v === undefined) throw new Error('ENOENT');
    return v;
  }
  async write(p: string, d: string): Promise<void> {
    this.files.set(p, d);
  }
  async rename(): Promise<void> {
    /* no-op */
  }
  async remove(p: string): Promise<void> {
    this.files.delete(p);
  }
  async list(): Promise<{ files: string[]; folders: string[] }> {
    return { files: [...this.files.keys()], folders: [] };
  }
  async stat(): Promise<null> {
    return null;
  }
}

function mainCtx(): ToolCtx {
  return { ...makeToolCtx({ thread: 't-1' }), agentId: null };
}

function subagentCtx(): ToolCtx {
  return { ...makeToolCtx({ thread: 't-1' }), agentId: 'sub-1' };
}

describe('plan mode tools', () => {
  it('EnterPlanMode flips controller mode, returns plan file path, accepts no-arg {}', async () => {
    const controller = new PlanModeController({ todoStore: new TodoStore() });
    const vault = new FakeVault();
    const planStore = new PlanStore({ vault });
    const tool = createEnterPlanModeTool({ controller, planStore });
    const args = tool.validate({});
    expect(args.ok).toBe(true);
    if (!args.ok) return;
    const res = await tool.invoke(args.data, mainCtx());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.mode).toBe('plan');
      expect(res.data.planFilePath).toMatch(/\.leo\/plans\/[a-z]+-[a-z]+\.md$/);
    }
    expect(controller.getMode('t-1')).toBe('plan');
    const [enter] = controller.drainAttachments('t-1');
    expect(enter?.body).toContain('.leo/plans/');
    expect(enter?.body).toContain('AskUserQuestion');
    expect(enter?.body).toContain('TodoWrite');
  });

  it('EnterPlanMode rejects subagent context with typed error and does not flip mode', async () => {
    const controller = new PlanModeController({ todoStore: new TodoStore() });
    const vault = new FakeVault();
    const planStore = new PlanStore({ vault });
    const tool = createEnterPlanModeTool({ controller, planStore });
    const res = await tool.invoke({}, subagentCtx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/plan mode forbidden in subagent/);
    expect(controller.getMode('t-1')).toBe('normal');
    expect(controller.drainAttachments('t-1').length).toBe(0);
  });

  it('ExitPlanMode on plain approve writes plan to disk and includes path line in tool result', async () => {
    const controller = new PlanModeController({ todoStore: new TodoStore() });
    const vault = new FakeVault();
    const planStore = new PlanStore({ vault });
    const approval = new PlanApprovalController();
    // Pre-set slug so we can predict the path
    planStore.setSlug('t-1', 'foo-bar');
    controller.enterPlan('t-1', planStore.planPath('foo-bar'));
    controller.drainAttachments('t-1');
    const tool = createExitPlanModeTool({ controller, planStore, approval });
    const args = tool.validate({ plan: '# plan body' });
    expect(args.ok).toBe(true);
    if (!args.ok) return;
    const resP = tool.invoke(args.data, mainCtx());
    await Promise.resolve();
    approval.resolve({ type: 'approve', planWasEdited: false, plan: '# plan body' });
    const res = await resP;
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.mode).toBe('normal');
      expect(res.data.planWasEdited).toBe(false);
      expect(res.data.planFilePath).toBe('.leo/plans/foo-bar.md');
      expect(res.data.message).toContain('Your plan has been saved to: .leo/plans/foo-bar.md');
      expect(res.data.message).toContain('## Approved Plan:');
      expect(res.data.message).toContain('# plan body');
    }
    expect(controller.getMode('t-1')).toBe('normal');
    expect(vault.files.get('.leo/plans/foo-bar.md')).toBe('# plan body');
  });

  it('ExitPlanMode on edit writes the edited plan and labels the result accordingly', async () => {
    const controller = new PlanModeController({ todoStore: new TodoStore() });
    const vault = new FakeVault();
    const planStore = new PlanStore({ vault });
    const approval = new PlanApprovalController();
    planStore.setSlug('t-1', 'foo-bar');
    controller.enterPlan('t-1', planStore.planPath('foo-bar'));
    controller.drainAttachments('t-1');
    const tool = createExitPlanModeTool({ controller, planStore, approval });
    const resP = tool.invoke({ plan: '# original' }, mainCtx());
    await Promise.resolve();
    approval.resolve({ type: 'edit', planWasEdited: true, plan: '# edited body' });
    const res = await resP;
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.planWasEdited).toBe(true);
      expect(res.data.message).toContain('## Approved Plan (edited by user):');
      expect(res.data.message).toContain('# edited body');
      expect(res.data.planFilePath).toBe('.leo/plans/foo-bar.md');
    }
    expect(vault.files.get('.leo/plans/foo-bar.md')).toBe('# edited body');
  });

  it('ExitPlanMode on subagent short-circuits to Case 2 without dialog or write', async () => {
    const controller = new PlanModeController({ todoStore: new TodoStore() });
    const vault = new FakeVault();
    const planStore = new PlanStore({ vault });
    const approval = new PlanApprovalController();
    let presentedCount = 0;
    const origPresent = approval.present.bind(approval);
    approval.present = (req) => {
      presentedCount += 1;
      return origPresent(req);
    };
    const tool = createExitPlanModeTool({ controller, planStore, approval });
    const res = await tool.invoke({ plan: 'x' }, subagentCtx());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.message).toBe(PLAN_APPROVAL_CASE_2_MESSAGE);
    expect(vault.files.size).toBe(0);
    expect(presentedCount).toBe(0);
  });

  it('ExitPlanMode with empty plan short-circuits to Case 3 without dialog', async () => {
    const controller = new PlanModeController({ todoStore: new TodoStore() });
    const vault = new FakeVault();
    const planStore = new PlanStore({ vault });
    const approval = new PlanApprovalController();
    let presentedCount = 0;
    const origPresent = approval.present.bind(approval);
    approval.present = (req) => {
      presentedCount += 1;
      return origPresent(req);
    };
    planStore.setSlug('t-1', 'foo-bar');
    controller.enterPlan('t-1', planStore.planPath('foo-bar'));
    const tool = createExitPlanModeTool({ controller, planStore, approval });
    const res = await tool.invoke({ plan: '   ' }, mainCtx());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.message).toBe(PLAN_APPROVAL_CASE_3_MESSAGE);
    expect(presentedCount).toBe(0);
    expect(vault.files.size).toBe(0);
    expect(controller.getMode('t-1')).toBe('normal');
  });

  it('ExitPlanMode validate rejects non-string plan and missing plan', () => {
    const controller = new PlanModeController({ todoStore: new TodoStore() });
    const vault = new FakeVault();
    const planStore = new PlanStore({ vault });
    const approval = new PlanApprovalController();
    const tool = createExitPlanModeTool({ controller, planStore, approval });
    expect(tool.validate({ plan: 42 }).ok).toBe(false);
    expect(tool.validate({}).ok).toBe(false);
  });

  it('both tools are requiresConfirmation=false (gated by permission system, not prompt)', () => {
    const controller = new PlanModeController({ todoStore: new TodoStore() });
    const vault = new FakeVault();
    const planStore = new PlanStore({ vault });
    const approval = new PlanApprovalController();
    expect(createEnterPlanModeTool({ controller, planStore }).requiresConfirmation).toBe(false);
    expect(createExitPlanModeTool({ controller, planStore, approval }).requiresConfirmation).toBe(
      false,
    );
  });
});
