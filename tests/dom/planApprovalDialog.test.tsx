// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { PlanApprovalDialog, makePlanApprovalSource } from '@/ui/chat/PlanApprovalDialog';
import { PlanApprovalController, type PlanApprovalOutcome } from '@/agent/planApprovalController';

afterEach(cleanup);

async function mountAndRequest(plan = '# Plan\n- step 1'): Promise<{
  controller: PlanApprovalController;
  container: HTMLElement;
  outcome: Promise<PlanApprovalOutcome>;
}> {
  const controller = new PlanApprovalController();
  const source = makePlanApprovalSource(controller);
  const { container } = render(<PlanApprovalDialog source={source} />);
  let outcome!: Promise<PlanApprovalOutcome>;
  await act(async () => {
    outcome = controller.present({ plan, threadId: 't-1', isSubagent: false });
  });
  return { controller, container, outcome };
}

describe('PlanApprovalDialog', () => {
  it('hidden when no pending request', () => {
    const controller = new PlanApprovalController();
    const source = makePlanApprovalSource(controller);
    const { container } = render(<PlanApprovalDialog source={source} />);
    const dlg = container.querySelector('[data-region="plan-approval"]');
    expect(dlg?.getAttribute('hidden')).not.toBeNull();
  });

  it('renders plan body + three buttons on pending request with role=dialog / aria-modal', async () => {
    const { container } = await mountAndRequest();
    const dlg = container.querySelector('[data-region="plan-approval"]');
    expect(dlg?.getAttribute('role')).toBe('dialog');
    expect(dlg?.getAttribute('aria-modal')).toBe('true');
    expect(dlg?.getAttribute('aria-live')).toBe('assertive');
    expect(container.querySelector('[data-slot="plan-approval-plan"]')?.textContent).toContain(
      '# Plan',
    );
    expect(container.querySelector('[data-slot="plan-approval-approve"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="plan-approval-edit"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="plan-approval-reject"]')).not.toBeNull();
  });

  it('Approve resolves with type=approve, planWasEdited=false, plan verbatim', async () => {
    const { container, outcome } = await mountAndRequest('# Plan');
    await act(async () => {
      fireEvent.click(container.querySelector('[data-slot="plan-approval-approve"]')!);
    });
    const result = await outcome;
    expect(result).toEqual({ type: 'approve', planWasEdited: false, plan: '# Plan' });
  });

  it('Edit → Confirm resolves with type=edit, planWasEdited=true and edited text', async () => {
    const { container, outcome } = await mountAndRequest('# Plan');
    await act(async () => {
      fireEvent.click(container.querySelector('[data-slot="plan-approval-edit"]')!);
    });
    const textarea = container.querySelector<HTMLTextAreaElement>(
      '[data-slot="plan-approval-textarea"]',
    )!;
    expect(textarea.value).toBe('# Plan');
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '# Edited plan' } });
    });
    await act(async () => {
      fireEvent.click(container.querySelector('[data-slot="plan-approval-confirm"]')!);
    });
    const result = await outcome;
    expect(result).toEqual({ type: 'edit', planWasEdited: true, plan: '# Edited plan' });
  });

  it('Edit → Cancel returns to view state without side effects', async () => {
    const { container } = await mountAndRequest('# Plan');
    await act(async () => {
      fireEvent.click(container.querySelector('[data-slot="plan-approval-edit"]')!);
    });
    expect(container.querySelector('[data-phase="edit"]')).not.toBeNull();
    await act(async () => {
      fireEvent.click(container.querySelector('[data-slot="plan-approval-cancel"]')!);
    });
    expect(container.querySelector('[data-phase="view"]')).not.toBeNull();
  });

  it('Reject resolves with type=reject', async () => {
    const { container, outcome } = await mountAndRequest();
    await act(async () => {
      fireEvent.click(container.querySelector('[data-slot="plan-approval-reject"]')!);
    });
    const result = await outcome;
    expect(result).toEqual({ type: 'reject' });
  });

  it('Esc in view state rejects', async () => {
    const { outcome } = await mountAndRequest();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    const result = await outcome;
    expect(result).toEqual({ type: 'reject' });
  });

  it('Esc in edit state first returns to view, second Esc rejects', async () => {
    const { container, outcome } = await mountAndRequest();
    await act(async () => {
      fireEvent.click(container.querySelector('[data-slot="plan-approval-edit"]')!);
    });
    expect(container.querySelector('[data-phase="edit"]')).not.toBeNull();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(container.querySelector('[data-phase="view"]')).not.toBeNull();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    const result = await outcome;
    expect(result).toEqual({ type: 'reject' });
  });

  it('Tab cycles Approve → Edit → Reject in view state, Shift+Tab reverses', async () => {
    const { container } = await mountAndRequest();
    const approve = container.querySelector<HTMLButtonElement>(
      '[data-slot="plan-approval-approve"]',
    )!;
    const edit = container.querySelector<HTMLButtonElement>('[data-slot="plan-approval-edit"]')!;
    const reject = container.querySelector<HTMLButtonElement>(
      '[data-slot="plan-approval-reject"]',
    )!;
    approve.focus();
    expect(document.activeElement).toBe(approve);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    });
    expect(document.activeElement).toBe(edit);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    });
    expect(document.activeElement).toBe(reject);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    });
    expect(document.activeElement).toBe(approve);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }));
    });
    expect(document.activeElement).toBe(reject);
  });

  it('uses renderMarkdown hook when provided and cleans up on unmount', async () => {
    const controller = new PlanApprovalController();
    const source = makePlanApprovalSource(controller);
    let cleanupCalls = 0;
    const renderMarkdown = (container: HTMLElement, plan: string): (() => void) => {
      const div = document.createElement('div');
      div.dataset.markdownRendered = plan;
      container.appendChild(div);
      return () => {
        cleanupCalls += 1;
      };
    };
    const { container, unmount } = render(
      <PlanApprovalDialog source={source} renderMarkdown={renderMarkdown} />,
    );
    await act(async () => {
      controller.present({ plan: '# rendered', threadId: 't-1', isSubagent: false });
    });
    expect(
      container.querySelector<HTMLElement>('[data-markdown-rendered]')?.dataset.markdownRendered,
    ).toBe('# rendered');
    unmount();
    expect(cleanupCalls).toBe(1);
  });

  it('focus moves to Approve on mount', async () => {
    const { container } = await mountAndRequest();
    const approve = container.querySelector<HTMLButtonElement>(
      '[data-slot="plan-approval-approve"]',
    )!;
    expect(document.activeElement).toBe(approve);
  });
});
