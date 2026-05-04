// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ExternalAgentWidget } from '@/ui/chat/blocks/ExternalAgentWidget';
import { PiiDetectorContext } from '@/ui/chat/blocks/piiDetectorContext';
import type {
  ExternalAgentWidgetController,
  WidgetViewModel,
} from '@/agent/externalAgent/widgetController';
import type { PiiDetectAgent, PiiFinding } from '@/agent/externalAgent/piiDetectAgent';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const PROMPT = 'Send the report to jane.doe@example.com. My AWS key is AKIAIOSFODNN7EXAMPLE. Done.';

const EMAIL = 'jane.doe@example.com';
const KEY = 'AKIAIOSFODNN7EXAMPLE';
const EMAIL_START = PROMPT.indexOf(EMAIL);
const KEY_START = PROMPT.indexOf(KEY);

const SCRIPTED_FINDINGS: readonly PiiFinding[] = [
  {
    id: `email-${EMAIL_START}`,
    kind: 'email',
    start: EMAIL_START,
    end: EMAIL_START + EMAIL.length,
    sample: 'j****e@e****e.com',
    suggestion: 'mask',
  },
  {
    id: `apikey-${KEY_START}`,
    kind: 'apiKey',
    start: KEY_START,
    end: KEY_START + KEY.length,
    sample: 'A**E',
    suggestion: 'remove',
  },
];

function makeController(vm: WidgetViewModel): {
  controller: ExternalAgentWidgetController;
  calls: { onSend: ReturnType<typeof vi.fn> };
} {
  const calls = { onSend: vi.fn() };
  const stub: Partial<ExternalAgentWidgetController> = {
    viewModel: () => vm,
    subscribe: () => () => undefined,
    onSend: calls.onSend,
    onEdit: () => undefined,
    onCancel: () => undefined,
    onSelectAdapter: () => undefined,
    onSetTimeout: () => undefined,
    onSetBudget: () => undefined,
    onAnswerClarification: () => undefined,
    dispose: () => undefined,
  };
  return { controller: stub as ExternalAgentWidgetController, calls };
}

const readyVm = (refinedPrompt: string): WidgetViewModel => ({
  runId: 'r1',
  threadId: 't1',
  phase: 'ready',
  originalAsk: 'send a report',
  adapters: [{ id: 'mock', label: 'Mock', defaultTimeoutMs: 30_000 }],
  draftAdapterId: 'mock',
  draftTimeoutMs: 300_000,
  draftTimeoutMinutes: 5,
  draftRefineBudget: 3,
  clarifyingQuestion: null,
  logEvents: [],
  validationError: null,
  refinedPrompt,
  textBuffer: '',
  resultFolder: null,
  writtenFiles: [],
  error: null,
  startedAt: null,
  endedAt: null,
});

interface FakeDetectorOpts {
  readonly findings?: readonly PiiFinding[];
  readonly fail?: string;
  readonly never?: boolean;
}

function fakeDetector(opts: FakeDetectorOpts): PiiDetectAgent {
  return {
    detect(_text: string, signal: AbortSignal): Promise<readonly PiiFinding[]> {
      if (opts.never === true) return new Promise(() => undefined);
      if (opts.fail !== undefined) return Promise.reject(new Error(opts.fail));
      if (signal.aborted) return Promise.resolve([]);
      return Promise.resolve(opts.findings ?? []);
    },
  };
}

function renderWithDetector(
  vm: WidgetViewModel,
  detector: PiiDetectAgent,
): ReturnType<typeof render> & { calls: { onSend: ReturnType<typeof vi.fn> } } {
  const { controller, calls } = makeController(vm);
  const utils = render(
    <PiiDetectorContext.Provider value={detector}>
      <ExternalAgentWidget controller={controller} />
    </PiiDetectorContext.Provider>,
  );
  return Object.assign(utils, { calls });
}

describe('ExternalAgentWidget — Ready phase PII review', () => {
  it('shows banner with findings after debounced scan and disables Send', async () => {
    vi.useFakeTimers();
    const utils = renderWithDetector(
      readyVm(PROMPT),
      fakeDetector({ findings: SCRIPTED_FINDINGS }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    vi.useRealTimers();
    await waitFor(() => {
      expect(utils.container.querySelector('[data-slot="pii-review"]')).not.toBeNull();
    });
    const rows = utils.container.querySelectorAll('[data-slot="pii-finding"]');
    expect(rows).toHaveLength(2);
    const sendBtn = utils.getByLabelText(
      'Send refined prompt to external agent',
    ) as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });

  it('clicking Mask rewrites textarea live and finding disappears on re-scan', async () => {
    vi.useFakeTimers();
    let lastSeenText = '';
    const detector: PiiDetectAgent = {
      async detect(text: string): Promise<readonly PiiFinding[]> {
        lastSeenText = text;
        return SCRIPTED_FINDINGS.filter((f) => text.includes(text.slice(f.start, f.end)));
      },
    };
    const utils = renderWithDetector(readyVm(PROMPT), detector);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    expect(utils.container.querySelectorAll('[data-slot="pii-finding"]').length).toBeGreaterThan(0);
    const firstRow = utils.container.querySelector('[data-slot="pii-finding"]');
    const maskBtn = firstRow?.querySelector(
      '[aria-label="Mask this finding"]',
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(maskBtn);
    });
    const ta = utils.getByLabelText('Refined prompt') as HTMLTextAreaElement;
    expect(ta.value).toContain('[email]');
    expect(ta.value).not.toContain(EMAIL);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    expect(lastSeenText).not.toContain(EMAIL);
    vi.useRealTimers();
  });

  it('Ignore all enables Send and onSend dispatches the (unmasked) draft', async () => {
    vi.useFakeTimers();
    const utils = renderWithDetector(
      readyVm(PROMPT),
      fakeDetector({ findings: SCRIPTED_FINDINGS }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    expect(utils.container.querySelector('[data-slot="pii-review"]')).not.toBeNull();
    const ignoreAll = utils.getByLabelText('Ignore all findings') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(ignoreAll);
    });
    const sendBtn = utils.getByLabelText(
      'Send refined prompt to external agent',
    ) as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(sendBtn);
    });
    expect(utils.calls.onSend).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('Apply suggested to all rewrites textarea with masks and removes', async () => {
    vi.useFakeTimers();
    const utils = renderWithDetector(
      readyVm(PROMPT),
      fakeDetector({ findings: SCRIPTED_FINDINGS }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    expect(utils.container.querySelector('[data-slot="pii-review"]')).not.toBeNull();
    const applyAll = utils.getByLabelText(
      'Apply suggested decisions to all findings',
    ) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(applyAll);
    });
    const ta = utils.getByLabelText('Refined prompt') as HTMLTextAreaElement;
    expect(ta.value).toContain('[email]');
    expect(ta.value).not.toContain(EMAIL);
    expect(ta.value).not.toContain(KEY);
    vi.useRealTimers();
  });

  it('detector error shows banner with Retry; Send stays disabled', async () => {
    vi.useFakeTimers();
    const utils = renderWithDetector(readyVm(PROMPT), fakeDetector({ fail: 'boom' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    vi.useRealTimers();
    await waitFor(() => {
      expect(utils.container.querySelector('[data-slot="pii-error"]')).not.toBeNull();
    });
    expect(utils.container.textContent).toContain('Detection failed');
    const sendBtn = utils.getByLabelText(
      'Send refined prompt to external agent',
    ) as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });

  it('empty draft reaches ready status with no findings; Send enabled', async () => {
    const utils = renderWithDetector(readyVm(''), fakeDetector({ findings: [] }));
    await waitFor(() => {
      expect(utils.container.querySelector('[data-slot="pii-review"]')).toBeNull();
    });
    const sendBtn = utils.getByLabelText(
      'Send refined prompt to external agent',
    ) as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(false);
  });
});
