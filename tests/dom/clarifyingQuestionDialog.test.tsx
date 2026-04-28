// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import {
  ClarifyingQuestionDialog,
  makeClarifyingQuestionSource,
} from '@/ui/chat/ClarifyingQuestionDialog';
import {
  ClarifyingQuestionController,
  type ClarifyingQuestionOutcome,
  type ClarifyingQuestionRequest,
} from '@/agent/clarifyingQuestionController';

afterEach(cleanup);

async function mountAndAsk(request: Omit<ClarifyingQuestionRequest, 'threadId'>): Promise<{
  controller: ClarifyingQuestionController;
  container: HTMLElement;
  outcome: Promise<ClarifyingQuestionOutcome>;
}> {
  const controller = new ClarifyingQuestionController();
  const source = makeClarifyingQuestionSource(controller);
  const { container } = render(<ClarifyingQuestionDialog source={source} />);
  let outcome!: Promise<ClarifyingQuestionOutcome>;
  await act(async () => {
    outcome = controller.present({ threadId: 't-1', ...request });
  });
  return { controller, container, outcome };
}

describe('ClarifyingQuestionDialog', () => {
  it('hidden when no pending question', () => {
    const controller = new ClarifyingQuestionController();
    const source = makeClarifyingQuestionSource(controller);
    const { container } = render(<ClarifyingQuestionDialog source={source} />);
    const dlg = container.querySelector('[data-region="clarify"]');
    expect(dlg?.getAttribute('hidden')).not.toBeNull();
  });

  it('renders question + radio options + header chip for single-select', async () => {
    const { container } = await mountAndAsk({
      question: 'pick one?',
      header: 'Choice',
      options: ['a', 'b'],
    });
    const dlg = container.querySelector('[data-region="clarify"]');
    expect(dlg?.getAttribute('role')).toBe('dialog');
    expect(dlg?.getAttribute('data-multi-select')).toBe('false');
    expect(container.querySelector('[data-slot="clarify-header-chip"]')?.textContent).toBe(
      'Choice',
    );
    expect(container.querySelector('[data-slot="clarify-question"]')?.textContent).toBe(
      'pick one?',
    );
    const inputs = container.querySelectorAll<HTMLInputElement>(
      '[data-slot="clarify-option-input"]',
    );
    expect(inputs.length).toBe(2);
    expect(inputs[0]!.type).toBe('radio');
  });

  it('Send is disabled until an option is selected, then resolves with single answer', async () => {
    const { container, outcome } = await mountAndAsk({
      question: 'pick?',
      options: ['a', 'b'],
    });
    const send = container.querySelector<HTMLButtonElement>('[data-slot="clarify-send"]')!;
    expect(send.disabled).toBe(true);
    await act(async () => {
      fireEvent.click(container.querySelectorAll('[data-slot="clarify-option-input"]')[0]!);
    });
    expect(send.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(send);
    });
    expect(await outcome).toEqual({ type: 'answer', answer: 'a' });
  });

  it('multiSelect renders checkboxes and resolves with answerMulti', async () => {
    const { container, outcome } = await mountAndAsk({
      question: 'tags?',
      options: ['x', 'y', 'z'],
      multiSelect: true,
    });
    const dlg = container.querySelector('[data-region="clarify"]');
    expect(dlg?.getAttribute('data-multi-select')).toBe('true');
    const inputs = container.querySelectorAll<HTMLInputElement>(
      '[data-slot="clarify-option-input"]',
    );
    expect(inputs[0]!.type).toBe('checkbox');
    await act(async () => {
      fireEvent.click(inputs[0]!);
      fireEvent.click(inputs[2]!);
    });
    await act(async () => {
      fireEvent.click(container.querySelector('[data-slot="clarify-send"]')!);
    });
    expect(await outcome).toEqual({ type: 'answerMulti', answers: ['x', 'z'] });
  });

  it('freeform renders textarea and resolves with trimmed answer', async () => {
    const { container, outcome } = await mountAndAsk({ question: 'title?' });
    const ta = container.querySelector<HTMLTextAreaElement>('[data-slot="clarify-textarea"]')!;
    expect(ta).not.toBeNull();
    const send = container.querySelector<HTMLButtonElement>('[data-slot="clarify-send"]')!;
    expect(send.disabled).toBe(true);
    await act(async () => {
      fireEvent.change(ta, { target: { value: '  Hub  ' } });
    });
    expect(send.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(send);
    });
    expect(await outcome).toEqual({ type: 'answer', answer: 'Hub' });
  });

  it('Cancel resolves with cancel', async () => {
    const { container, outcome } = await mountAndAsk({ question: 'q?' });
    await act(async () => {
      fireEvent.click(container.querySelector('[data-slot="clarify-cancel"]')!);
    });
    expect(await outcome).toEqual({ type: 'cancel' });
  });
});
