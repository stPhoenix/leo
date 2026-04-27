import type { Meta, StoryObj } from '@storybook/react-vite';
import { ExternalAgentWidget } from './ExternalAgentWidget';
import type {
  ExternalAgentWidgetController,
  WidgetViewModel,
} from '@/agent/externalAgent/widgetController';

function fakeController(vm: WidgetViewModel): ExternalAgentWidgetController {
  const stub: Partial<ExternalAgentWidgetController> = {
    viewModel: () => vm,
    subscribe: () => () => undefined,
    onSend: () => undefined,
    onEdit: () => undefined,
    onCancel: () => undefined,
    onSelectAdapter: () => undefined,
    onSetTimeout: () => undefined,
    onSetBudget: () => undefined,
    onAnswerClarification: () => undefined,
    dispose: () => undefined,
  };
  return stub as ExternalAgentWidgetController;
}

const baseVm = (overrides: Partial<WidgetViewModel> = {}): WidgetViewModel => ({
  runId: '20260427-141503-a1b2c3',
  threadId: 't1',
  phase: 'preparing',
  originalAsk: 'research evolutionary game theory',
  adapters: [
    { id: 'claude-code', label: 'claude-code', defaultTimeoutMs: 1_800_000 },
    { id: 'openai-compatible', label: 'openai-compatible', defaultTimeoutMs: 600_000 },
  ],
  draftAdapterId: 'claude-code',
  draftTimeoutMs: 60_000,
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

const meta: Meta<typeof ExternalAgentWidget> = {
  title: 'Chat/Blocks/ExternalAgentWidget',
  component: ExternalAgentWidget,
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof ExternalAgentWidget>;

export const PreparingIdle: Story = {
  args: {
    controller: fakeController(baseVm({ phase: 'preparing' })),
  },
};

export const PreparingAwaitingClarification: Story = {
  args: {
    controller: fakeController(
      baseVm({
        phase: 'awaiting_clarify',
        clarifyingQuestion:
          'What specific area of game theory should I focus on? (cooperative, non-cooperative, evolutionary…)',
      }),
    ),
  },
};

export const ReadyDefault: Story = {
  args: {
    controller: fakeController(
      baseVm({
        phase: 'ready',
        refinedPrompt:
          'Please research evolutionary game theory: ESS, replicator dynamics, examples in biology and economics. Provide a 1500-word overview. Include 5 academic references with DOIs.',
      }),
    ),
  },
};

export const ReadyEmptyAdapters: Story = {
  args: {
    controller: fakeController(
      baseVm({
        phase: 'ready',
        adapters: [],
        draftAdapterId: null,
        refinedPrompt: 'Refined prompt here.',
      }),
    ),
  },
};

export const ReadyValidationError: Story = {
  args: {
    controller: fakeController(
      baseVm({
        phase: 'ready',
        refinedPrompt: 'Refined prompt here.',
        validationError: 'timeoutMs out of range [1000, 86400000]',
      }),
    ),
  },
};

export const RunningEarlyStream: Story = {
  args: {
    controller: fakeController(
      baseVm({
        phase: 'running',
        refinedPrompt: 'Final prompt body.',
        textBuffer: 'Evolutionary game theory studies strategy frequencies in populations…',
        startedAt: Date.now() - 42_000,
        logEvents: [
          { level: 'info', msg: 'adapter started', ts: Date.now() - 41_000 },
          { level: 'debug', msg: 'first chunk received', ts: Date.now() - 40_000 },
        ],
      }),
    ),
  },
};

export const RunningWithFiles: Story = {
  args: {
    controller: fakeController(
      baseVm({
        phase: 'running',
        refinedPrompt: 'Final prompt body.',
        textBuffer:
          'Evolutionary game theory studies strategy frequencies in populations over time, drawing on the replicator dynamics framework introduced by Taylor and Jonker (1978).',
        startedAt: Date.now() - 122_000,
        logEvents: [
          { level: 'info', msg: 'adapter started', ts: Date.now() - 121_000 },
          { level: 'debug', msg: 'received chunk #12', ts: Date.now() - 60_000 },
          { level: 'warn', msg: 'rate limit slowdown', ts: Date.now() - 30_000 },
        ],
      }),
    ),
  },
};

export const TerminalDone: Story = {
  args: {
    controller: fakeController(
      baseVm({
        phase: 'done',
        refinedPrompt: 'Final prompt body.',
        textBuffer: 'A long markdown response with sources and citations …',
        resultFolder: 'externalAgentResults/20260427-141503-a1b2c3',
        writtenFiles: ['request.md', 'response.md', 'sources.md'],
        startedAt: Date.now() - 192_000,
        endedAt: Date.now(),
      }),
    ),
  },
};

export const TerminalCancelled: Story = {
  args: {
    controller: fakeController(
      baseVm({
        phase: 'cancelled',
        startedAt: Date.now() - 12_000,
        endedAt: Date.now(),
      }),
    ),
  },
};

export const TerminalError: Story = {
  args: {
    controller: fakeController(
      baseVm({
        phase: 'error',
        error: { code: 'timeout', message: 'Adapter exceeded 60 s' },
        startedAt: Date.now() - 60_000,
        endedAt: Date.now(),
        resultFolder: 'externalAgentResults/20260427-141503-a1b2c3',
        writtenFiles: ['error.md'],
      }),
    ),
  },
};

export const TerminalReload: Story = {
  args: {
    controller: fakeController(
      baseVm({
        phase: 'error',
        error: { code: 'reload', message: 'Plugin reloaded during run' },
      }),
    ),
  },
};
