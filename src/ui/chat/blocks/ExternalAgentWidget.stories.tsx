import type { Meta, StoryObj } from '@storybook/react-vite';
import { createElement } from 'react';
import { ExternalAgentWidget } from './ExternalAgentWidget';
import type {
  ExternalAgentWidgetController,
  WidgetViewModel,
} from '@/agent/externalAgent/widgetController';
import type { PiiDetectAgent, PiiFinding } from '@/agent/externalAgent/piiDetectAgent';
import { PiiDetectorContext } from './piiDetectorContext';

interface FakeDetectorScenario {
  readonly findings?: readonly PiiFinding[];
  readonly delayMs?: number;
  readonly throw?: string;
  readonly never?: boolean;
}

function fakeDetector(scenario: FakeDetectorScenario): PiiDetectAgent {
  return {
    detect(_text: string, signal: AbortSignal): Promise<readonly PiiFinding[]> {
      if (scenario.never === true) {
        return new Promise(() => undefined);
      }
      const delay = scenario.delayMs ?? 0;
      return new Promise((resolve, reject) => {
        const t = window.setTimeout(() => {
          if (signal.aborted) return;
          if (scenario.throw !== undefined) reject(new Error(scenario.throw));
          else resolve(scenario.findings ?? []);
        }, delay);
        signal.addEventListener('abort', () => window.clearTimeout(t));
      });
    },
  };
}

function withDetector(detector: PiiDetectAgent): (Story: () => JSX.Element) => JSX.Element {
  return (Story) =>
    createElement(PiiDetectorContext.Provider, { value: detector }, createElement(Story));
}

const piiFindings: readonly PiiFinding[] = [
  {
    id: 'email-1',
    kind: 'email',
    start: 24,
    end: 44,
    sample: 'j*****e@e*****e.com',
    suggestion: 'mask',
  },
  {
    id: 'apikey-1',
    kind: 'apiKey',
    start: 60,
    end: 80,
    sample: 'A******************E',
    suggestion: 'remove',
  },
  {
    id: 'phone-1',
    kind: 'phone',
    start: 91,
    end: 103,
    sample: '+*********67',
    suggestion: 'mask',
  },
];

const PROMPT_WITH_PII =
  'Send the quarterly report to jane.doe@example.com. My AWS key is AKIAIOSFODNN7EXAMPLE. Call +14155551234 if anything is unclear.';

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

// Inline-agent fixtures (F18).
const inlineBaseVm = (overrides: Partial<WidgetViewModel> = {}): WidgetViewModel => ({
  ...baseVm(),
  adapters: [
    { id: 'inline-agent', label: 'Inline Agent', defaultTimeoutMs: 300_000 },
    { id: 'claude-code', label: 'claude-code', defaultTimeoutMs: 1_800_000 },
  ],
  draftAdapterId: 'inline-agent',
  ...overrides,
});

export const InlineAgentSimple: Story = {
  args: {
    controller: fakeController(
      inlineBaseVm({
        phase: 'running',
        refinedPrompt: 'Summarise the SRS for inline-agent in three bullets.',
        textBuffer:
          'The Inline Agent runs as a LangGraph subgraph in the renderer with its own provider and model.\n' +
          'Its toolset (fetch_url, search_web, sandbox file ops, publish_artifact, extract_note) is isolated from the main agent.',
        startedAt: Date.now() - 7_400,
        logEvents: [
          {
            level: 'info',
            msg: 'node.complete {"node":"classify_task","route":"simple"}',
            ts: Date.now() - 7_000,
          },
          {
            level: 'info',
            msg: 'tool.start {"tool":"search_web","args":{"query":{"length":42,"elided":true}}}',
            ts: Date.now() - 6_500,
          },
          {
            level: 'info',
            msg: 'tool.start {"tool":"publish_artifact","args":{"relPath":"summary.md"}}',
            ts: Date.now() - 1_200,
          },
        ],
      }),
    ),
  },
};

export const InlineAgentMultistep: Story = {
  args: {
    controller: fakeController(
      inlineBaseVm({
        phase: 'running',
        refinedPrompt:
          'Compare evolutionary game theory and replicator dynamics across three sources.',
        textBuffer: 'Synthesis: …',
        startedAt: Date.now() - 95_000,
        logEvents: [
          {
            level: 'info',
            msg: 'node.complete {"node":"classify_task","route":"multistep","planLength":3}',
            ts: Date.now() - 94_000,
          },
          {
            level: 'info',
            msg: 'node.complete {"node":"planner","planLength":3}',
            ts: Date.now() - 92_000,
          },
          {
            level: 'info',
            msg: 'node.complete {"node":"researchStep","stepIndex":0,"durationMs":12000}',
            ts: Date.now() - 80_000,
          },
          {
            level: 'info',
            msg: 'node.complete {"node":"researchStep","stepIndex":1,"durationMs":15000}',
            ts: Date.now() - 65_000,
          },
          {
            level: 'info',
            msg: 'node.complete {"node":"researchStep","stepIndex":2,"durationMs":10000}',
            ts: Date.now() - 55_000,
          },
          {
            level: 'info',
            msg: 'tool.start {"tool":"publish_artifact","args":{"relPath":"summary.md"}}',
            ts: Date.now() - 1_500,
          },
          {
            level: 'info',
            msg: 'tool.start {"tool":"publish_artifact","args":{"relPath":"sources.md"}}',
            ts: Date.now() - 800,
          },
        ],
      }),
    ),
  },
};

export const InlineAgentClassifierFallback: Story = {
  args: {
    controller: fakeController(
      inlineBaseVm({
        phase: 'running',
        refinedPrompt: 'Convert these notes to a markdown summary.',
        textBuffer: 'Markdown summary draft …',
        startedAt: Date.now() - 12_000,
        logEvents: [
          {
            level: 'warn',
            msg: 'router.classify-fallback {"reason":"schema parse failed"}',
            ts: Date.now() - 11_500,
          },
          {
            level: 'info',
            msg: 'node.complete {"node":"classify_task","route":"simple"}',
            ts: Date.now() - 11_000,
          },
          {
            level: 'info',
            msg: 'tool.start {"tool":"write_file","args":{"relPath":"summary.md","content":{"length":420,"elided":true}}}',
            ts: Date.now() - 4_000,
          },
        ],
      }),
    ),
  },
};

// PII review fixtures.

export const ReadyNoPii: Story = {
  decorators: [withDetector(fakeDetector({ findings: [] }))],
  args: {
    controller: fakeController(
      baseVm({
        phase: 'ready',
        refinedPrompt: 'Summarise the quarterly sales numbers in three bullets.',
      }),
    ),
  },
};

export const ReadyScanningPii: Story = {
  decorators: [withDetector(fakeDetector({ never: true }))],
  args: {
    controller: fakeController(
      baseVm({
        phase: 'ready',
        refinedPrompt: PROMPT_WITH_PII,
      }),
    ),
  },
};

export const ReadyWithPiiPending: Story = {
  decorators: [withDetector(fakeDetector({ findings: piiFindings, delayMs: 200 }))],
  args: {
    controller: fakeController(
      baseVm({
        phase: 'ready',
        refinedPrompt: PROMPT_WITH_PII,
      }),
    ),
  },
};

export const ReadyDetectorError: Story = {
  decorators: [withDetector(fakeDetector({ throw: 'provider unavailable', delayMs: 200 }))],
  args: {
    controller: fakeController(
      baseVm({
        phase: 'ready',
        refinedPrompt: PROMPT_WITH_PII,
      }),
    ),
  },
};

export const InlineAgentIterationLimit: Story = {
  args: {
    controller: fakeController(
      inlineBaseVm({
        phase: 'error',
        refinedPrompt: 'Audit a long codebase and produce N-paged report.',
        error: {
          code: 'iteration_limit',
          message: 'simple branch exceeded 12 iterations',
        },
        resultFolder: 'externalAgentResults/20260427-141503-a1b2c3',
        writtenFiles: ['summary.md'],
        startedAt: Date.now() - 92_000,
        endedAt: Date.now(),
        logEvents: [
          {
            level: 'info',
            msg: 'node.complete {"node":"classify_task","route":"simple"}',
            ts: Date.now() - 90_000,
          },
          {
            level: 'info',
            msg: 'tool.start {"tool":"publish_artifact","args":{"relPath":"summary.md"}}',
            ts: Date.now() - 12_000,
          },
          {
            level: 'warn',
            msg: 'iteration-limit reached; partial artifacts flushed',
            ts: Date.now() - 1_000,
          },
        ],
      }),
    ),
  },
};
