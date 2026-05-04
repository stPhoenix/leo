// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { ExternalAgentWidget } from '@/ui/chat/blocks/ExternalAgentWidget';
import type {
  ExternalAgentWidgetController,
  WidgetViewModel,
} from '@/agent/externalAgent/widgetController';

afterEach(cleanup);

function makeController(vm: WidgetViewModel) {
  const calls = {
    onSend: vi.fn(),
    onEdit: vi.fn(),
    onCancel: vi.fn(),
    onSelectAdapter: vi.fn(),
    onSetTimeout: vi.fn(),
    onSetBudget: vi.fn(),
    onAnswerClarification: vi.fn(),
  };
  const stub: Partial<ExternalAgentWidgetController> = {
    viewModel: () => vm,
    subscribe: () => () => undefined,
    ...calls,
    dispose: () => undefined,
  };
  return { controller: stub as ExternalAgentWidgetController, calls };
}

const baseVm = (overrides: Partial<WidgetViewModel> = {}): WidgetViewModel => ({
  runId: 'r1',
  threadId: 't1',
  phase: 'preparing',
  originalAsk: 'ask',
  adapters: [{ id: 'mock', label: 'Mock', defaultTimeoutMs: 30_000 }],
  draftAdapterId: 'mock',
  draftTimeoutMs: 300_000,
  draftTimeoutMinutes: 5,
  draftRefineBudget: 3,
  clarifyingQuestion: null,
  logEvents: [],
  validationError: null,
  refinedPrompt: null,
  textBuffer: '',
  resultFolder: null,
  writtenFiles: [],
  error: null,
  startedAt: null,
  endedAt: null,
  ...overrides,
});

describe('ExternalAgentWidget — phase rendering', () => {
  it('preparing renders original ask and Cancel button', () => {
    const { controller } = makeController(baseVm({ phase: 'preparing' }));
    const { container } = render(<ExternalAgentWidget controller={controller} />);
    expect(container.querySelector('[data-phase="preparing"]')).not.toBeNull();
    expect(container.textContent).toContain('Original ask');
    expect(container.textContent).toContain('ask');
  });

  it('awaiting_clarify shows question and Send answer button', () => {
    const { controller, calls } = makeController(
      baseVm({ phase: 'awaiting_clarify', clarifyingQuestion: 'Which year?' }),
    );
    const { container, getByLabelText } = render(<ExternalAgentWidget controller={controller} />);
    expect(container.querySelector('[data-slot="external-agent-question"]')?.textContent).toBe(
      'Which year?',
    );
    const ta = getByLabelText('Answer to clarifying question') as HTMLTextAreaElement;
    act(() => fireEvent.change(ta, { target: { value: '2024' } }));
    const send = getByLabelText('Send clarifying answer');
    act(() => fireEvent.click(send));
    expect(calls.onAnswerClarification).toHaveBeenCalledWith('2024');
  });

  it('ready shows Send / Edit / Cancel; Send fires onSend with current draft', () => {
    const { controller, calls } = makeController(
      baseVm({ phase: 'ready', refinedPrompt: 'final body' }),
    );
    const { getByLabelText } = render(<ExternalAgentWidget controller={controller} />);
    const send = getByLabelText('Send refined prompt to external agent') as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    act(() => fireEvent.click(send));
    expect(calls.onSend).toHaveBeenCalled();
  });

  it('ready Edit button is disabled when textarea unchanged', () => {
    const { controller } = makeController(baseVm({ phase: 'ready', refinedPrompt: 'final body' }));
    const { getByLabelText } = render(<ExternalAgentWidget controller={controller} />);
    const edit = getByLabelText('Edit refined prompt') as HTMLButtonElement;
    expect(edit.disabled).toBe(true);
  });

  it('ready Send is disabled when no adapter selected', () => {
    const { controller } = makeController(
      baseVm({ phase: 'ready', refinedPrompt: 'x', adapters: [], draftAdapterId: null }),
    );
    const { getByLabelText } = render(<ExternalAgentWidget controller={controller} />);
    const send = getByLabelText('Send refined prompt to external agent') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
  });

  it('running shows streaming text and Cancel', () => {
    const { controller, calls } = makeController(
      baseVm({
        phase: 'running',
        textBuffer: 'streamed words',
        startedAt: Date.now() - 5_000,
      }),
    );
    const { container, getByLabelText } = render(<ExternalAgentWidget controller={controller} />);
    expect(container.querySelector('[data-slot="external-agent-stream"]')?.textContent).toContain(
      'streamed words',
    );
    act(() => fireEvent.click(getByLabelText('Cancel external agent run')));
    expect(calls.onCancel).toHaveBeenCalled();
  });

  it('terminal done summary expands to show response and folder', () => {
    const { controller } = makeController(
      baseVm({
        phase: 'done',
        textBuffer: 'response body',
        refinedPrompt: 'final',
        resultFolder: 'externalAgentResults/r1',
        startedAt: 1_000,
        endedAt: 4_000,
      }),
    );
    const { container, getByLabelText } = render(<ExternalAgentWidget controller={controller} />);
    expect(container.textContent).toContain('externalAgentResults/r1');
    expect(container.textContent).toContain('3s');
    const toggle = getByLabelText('External agent run done — toggle details');
    act(() => fireEvent.click(toggle));
    expect(container.querySelector('[data-slot="external-agent-expanded"]')).not.toBeNull();
    expect(container.textContent).toContain('response body');
  });

  it('terminal reload variant shows distinct copy', () => {
    const { controller } = makeController(
      baseVm({
        phase: 'error',
        error: { code: 'reload', message: 'Plugin reloaded during run' },
      }),
    );
    const { container } = render(<ExternalAgentWidget controller={controller} />);
    const reloadEl = container.querySelector('[data-slot="external-agent-reload"]');
    expect(reloadEl).not.toBeNull();
    expect(reloadEl?.textContent).toContain('reloaded');
  });

  it('validation error renders alert when present', () => {
    const { controller } = makeController(
      baseVm({
        phase: 'ready',
        refinedPrompt: 'x',
        validationError: 'timeout out of range [1, 1440] minutes',
      }),
    );
    const { container } = render(<ExternalAgentWidget controller={controller} />);
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('minutes');
  });
});
