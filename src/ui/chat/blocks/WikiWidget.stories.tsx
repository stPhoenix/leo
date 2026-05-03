import type { Meta, StoryObj } from '@storybook/react-vite';
import { WikiWidget } from './WikiWidget';
import { WikiWidgetController } from '@/agent/wiki/widgetController';
import type { WikiViewModel } from '@/agent/wiki/widgetState';

function ctrl(op: 'ingest' | 'lint', patch: Partial<WikiViewModel>): WikiWidgetController {
  const c = new WikiWidgetController({ runId: '20260429-080000-abc123', threadId: 't1', op });
  c.update(patch);
  return c;
}

const meta: Meta<typeof WikiWidget> = {
  title: 'Chat/Blocks/WikiWidget',
  component: WikiWidget,
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof WikiWidget>;

export const IdleIngest: Story = {
  args: { controller: ctrl('ingest', {}) },
};

export const AwaitingConfigIdle: Story = {
  args: {
    controller: ctrl('ingest', {
      phase: 'awaiting_config',
      config: {
        providers: ['lmstudio', 'openai', 'anthropic', 'ollama', 'custom'],
        draftProviderId: 'lmstudio',
        draftModel: '',
        models: { state: 'idle' },
        defaultProviderId: 'lmstudio',
        defaultModel: 'qwen3',
        apiKeyMissing: false,
        validationError: null,
        originalAsk: 'Ingest URL into wiki: https://example.com/blog',
        sourcesSummary: 'https://example.com/blog',
      },
    }),
  },
};

export const AwaitingConfigLoading: Story = {
  args: {
    controller: ctrl('ingest', {
      phase: 'awaiting_config',
      config: {
        providers: ['lmstudio', 'openai'],
        draftProviderId: 'lmstudio',
        draftModel: '',
        models: { state: 'loading' },
        defaultProviderId: 'lmstudio',
        defaultModel: 'qwen3',
        apiKeyMissing: false,
        validationError: null,
        originalAsk: 'Ingest URL into wiki: https://example.com/blog',
        sourcesSummary: 'https://example.com/blog',
      },
    }),
  },
};

export const AwaitingConfigReady: Story = {
  args: {
    controller: ctrl('ingest', {
      phase: 'awaiting_config',
      config: {
        providers: ['lmstudio', 'openai', 'anthropic'],
        draftProviderId: 'lmstudio',
        draftModel: 'qwen3',
        models: {
          state: 'ok',
          items: [{ id: 'qwen3' }, { id: 'mistral-small' }],
        },
        defaultProviderId: 'lmstudio',
        defaultModel: 'qwen3',
        apiKeyMissing: false,
        validationError: null,
        originalAsk: 'Ingest URL into wiki: https://example.com/blog',
        sourcesSummary: 'https://example.com/blog',
      },
    }),
  },
};

export const AwaitingConfigError: Story = {
  args: {
    controller: ctrl('ingest', {
      phase: 'awaiting_config',
      config: {
        providers: ['lmstudio'],
        draftProviderId: 'lmstudio',
        draftModel: '',
        models: { state: 'error', error: 'connection refused' },
        defaultProviderId: 'lmstudio',
        defaultModel: 'qwen3',
        apiKeyMissing: false,
        validationError: null,
        originalAsk: 'Lint wiki: all pages',
        sourcesSummary: 'all pages',
      },
    }),
  },
};

export const AwaitingConfigApiKeyMissing: Story = {
  args: {
    controller: ctrl('ingest', {
      phase: 'awaiting_config',
      config: {
        providers: ['lmstudio', 'openai'],
        draftProviderId: 'openai',
        draftModel: 'gpt-4o',
        models: {
          state: 'ok',
          items: [{ id: 'gpt-4o' }],
        },
        defaultProviderId: 'lmstudio',
        defaultModel: 'qwen3',
        apiKeyMissing: true,
        validationError: null,
        originalAsk: 'Ingest URL into wiki: https://example.com/blog',
        sourcesSummary: 'https://example.com/blog',
      },
    }),
  },
};

export const Preparing: Story = {
  args: {
    controller: ctrl('ingest', {
      phase: 'preparing',
      refineTranscript: [
        { role: 'assistant', content: 'Which scope should I file? URLs only?' },
        { role: 'user', content: 'Just the new auth blog post' },
      ],
    }),
  },
};

export const AwaitingClarify: Story = {
  args: {
    controller: ctrl('ingest', {
      phase: 'awaiting_clarify',
      clarifyingQuestion: 'Should I include the comments section?',
    }),
  },
};

export const Fetching: Story = {
  args: {
    controller: ctrl('ingest', {
      phase: 'fetching',
      fetchProgress: { total: 5, completed: 2, current: 'https://example.com/blog/auth' },
    }),
  },
};

export const PersistingDuplicate: Story = {
  args: {
    controller: ctrl('ingest', {
      phase: 'persisting',
      persistProgress: { total: 5, completed: 3 },
      duplicatePrompt: {
        sourceRef: 'https://example.com/blog/auth',
        rawPath: 'wiki/raw/2026-04-29-auth.md',
      },
    }),
  },
};

export const Planning: Story = {
  args: {
    controller: ctrl('ingest', {
      phase: 'planning',
      plan: {
        perSource: [
          { rawPath: 'wiki/raw/2026-04-29-auth.md', candidatePages: ['pages/oauth', 'pages/jwt'] },
          { rawPath: 'wiki/raw/2026-04-29-rfc.md', candidatePages: ['pages/oauth'] },
        ],
      },
    }),
  },
};

export const Extracting: Story = {
  args: {
    controller: ctrl('ingest', {
      phase: 'extracting',
      extractProgress: { total: 5, completed: 3, failed: 1, current: 'wiki/raw/a.md' },
    }),
  },
};

export const Reducing: Story = {
  args: {
    controller: ctrl('ingest', {
      phase: 'reducing',
      reduceProgress: { total: 6, completed: 4 },
    }),
  },
};

export const Writing: Story = {
  args: {
    controller: ctrl('ingest', {
      phase: 'writing',
      writeProgress: { total: 8, completed: 5, current: 'wiki/pages/oauth.md' },
    }),
  },
};

export const IngestDone: Story = {
  args: {
    controller: ctrl('ingest', {
      phase: 'done',
      pagesCreated: 2,
      pagesEdited: 3,
      perSourceStatuses: [
        { rawPath: 'wiki/raw/a.md', status: 'ok' },
        { rawPath: 'wiki/raw/b.md', status: 'ok' },
      ],
    }),
  },
};

export const Cancelled: Story = {
  args: {
    controller: ctrl('ingest', { phase: 'cancelled' }),
  },
};

export const ErrorReload: Story = {
  args: {
    controller: WikiWidgetController.reloadRehydrate({
      runId: '20260429-080000-abc123',
      threadId: 't1',
      op: 'ingest',
    }),
  },
};

export const ErrorOther: Story = {
  args: {
    controller: ctrl('ingest', {
      phase: 'error',
      error: { code: 'fetch_failed', message: 'network unreachable' },
    }),
  },
};

export const Scanning: Story = {
  args: {
    controller: ctrl('lint', {
      phase: 'scanning',
      scanSummary: { pages: 124, sources: 87, orphanPages: 3, orphanRaw: 1 },
    }),
  },
};

export const Checking: Story = {
  args: {
    controller: ctrl('lint', {
      phase: 'checking',
      checkProgress: { total: 7, completed: 4 },
    }),
  },
};

export const AwaitingConfirm: Story = {
  args: {
    controller: ctrl('lint', {
      phase: 'awaiting_confirm',
      findings: [
        {
          id: 'f1',
          page: 'pages/oauth',
          action: 'add-xref',
          severity: 'info',
          rationale: '`pages/jwt` references oauth without a wikilink',
          accepted: null,
        },
        {
          id: 'f2',
          page: 'pages/jwt',
          action: 'rewrite-stale',
          severity: 'warn',
          rationale: 'Body cites RFC 7519 but version is outdated',
          accepted: null,
        },
      ],
      schemaPatchPending: true,
    }),
  },
};

export const LintDone: Story = {
  args: {
    controller: ctrl('lint', {
      phase: 'done',
      findings: [
        {
          id: 'f1',
          page: 'pages/oauth',
          action: 'add-xref',
          severity: 'info',
          rationale: 'r',
          accepted: true,
        },
        {
          id: 'f2',
          page: 'pages/jwt',
          action: 'rewrite-stale',
          severity: 'warn',
          rationale: 'r',
          accepted: false,
        },
      ],
    }),
  },
};
