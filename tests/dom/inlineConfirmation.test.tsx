// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { InlineConfirmation, makeInlineConfirmationSource } from '@/ui/chat/InlineConfirmation';
import {
  ConfirmationController,
  type ConfirmationDecision,
  type ToolConfirmationRequest,
} from '@/agent/confirmationController';

afterEach(cleanup);

const writeReq: ToolConfirmationRequest = {
  toolId: 'write_note',
  thread: 'default',
  argsJson: '{"path":"a.md"}',
  argsPretty: '{\n  "path": "a.md"\n}',
  category: 'write',
};

const readReq: ToolConfirmationRequest = { ...writeReq, toolId: 'read_note', category: 'read' };

async function mountAndRequest(req: ToolConfirmationRequest = writeReq): Promise<{
  controller: ConfirmationController;
  container: HTMLElement;
  decision: Promise<ConfirmationDecision>;
}> {
  const controller = new ConfirmationController();
  const source = makeInlineConfirmationSource(controller);
  const { container } = render(<InlineConfirmation source={source} />);
  let decision!: Promise<ConfirmationDecision>;
  await act(async () => {
    decision = controller.request(req);
  });
  return { controller, container, decision };
}

describe('InlineConfirmation dialog (F17)', () => {
  it('is hidden when no pending confirmation', () => {
    const controller = new ConfirmationController();
    const source = makeInlineConfirmationSource(controller);
    const { container } = render(<InlineConfirmation source={source} />);
    const dlg = container.querySelector('[data-region="confirmation"]');
    expect(dlg?.getAttribute('hidden')).not.toBeNull();
  });

  it('renders tool name, pretty args, and three buttons on pending write request', async () => {
    const { container } = await mountAndRequest(writeReq);
    expect(container.querySelector('[data-slot="confirmation-tool-name"]')?.textContent).toBe(
      'write_note',
    );
    expect(container.querySelector('[data-slot="confirmation-args"]')?.textContent).toContain(
      '"path": "a.md"',
    );
    expect(container.querySelector('[data-slot="confirmation-allow-once"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="confirmation-allow-thread"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="confirmation-deny"]')).not.toBeNull();
  });

  it('sets data-visual-state to awaiting-confirmation for write, idle for read', async () => {
    const r1 = await mountAndRequest(writeReq);
    expect(
      r1.container.querySelector('[data-region="confirmation"]')?.getAttribute('data-visual-state'),
    ).toBe('awaiting-confirmation');
    cleanup();

    const r2 = await mountAndRequest(readReq);
    expect(
      r2.container.querySelector('[data-region="confirmation"]')?.getAttribute('data-visual-state'),
    ).toBe('idle');
  });

  it('carries role="dialog", aria-modal="true", aria-live="assertive" on pending mount', async () => {
    const { container } = await mountAndRequest();
    const dlg = container.querySelector('[data-region="confirmation"]')!;
    expect(dlg.getAttribute('role')).toBe('dialog');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(dlg.getAttribute('aria-live')).toBe('assertive');
  });

  it('moves focus to the Allow-once primary action on mount', async () => {
    const { container } = await mountAndRequest();
    const allowOnce = container.querySelector<HTMLButtonElement>(
      '[data-slot="confirmation-allow-once"]',
    )!;
    expect(document.activeElement).toBe(allowOnce);
  });

  it('Allow-once button resolves with allow-once', async () => {
    const { container, decision } = await mountAndRequest();
    await act(async () => {
      fireEvent.click(container.querySelector('[data-slot="confirmation-allow-once"]')!);
    });
    await expect(decision).resolves.toBe('allow-once');
  });

  it('Allow-for-thread button resolves with allow-thread', async () => {
    const { container, decision } = await mountAndRequest();
    await act(async () => {
      fireEvent.click(container.querySelector('[data-slot="confirmation-allow-thread"]')!);
    });
    await expect(decision).resolves.toBe('allow-thread');
  });

  it('Deny button resolves with deny', async () => {
    const { container, decision } = await mountAndRequest();
    await act(async () => {
      fireEvent.click(container.querySelector('[data-slot="confirmation-deny"]')!);
    });
    await expect(decision).resolves.toBe('deny');
  });

  it('Escape key is equivalent to Deny', async () => {
    const { decision } = await mountAndRequest();
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    await expect(decision).resolves.toBe('deny');
  });
});
