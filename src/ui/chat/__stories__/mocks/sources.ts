import type { FocusedContext } from '@/editor/types';
import { NULL_FOCUSED_CONTEXT } from '@/editor/types';
import type { ChatMessageRecord } from '@/chat/types';
import { ChatMessageStore } from '@/chat/messageStore';
import type { StreamingPhase } from '@/chat/streamingController';
import type { ThreadsSnapshot } from '@/storage/threadsStore';
import type { ContextIndicatorSource } from '../../ContextIndicator';
import type { IndexStatusSource } from '../../IndexEmptyStateCta';
import type { PhaseSource, QueueSource } from '../../ChatRoot';
import type { ThreadsUiSource } from '../../ThreadSwitcher';
import { marked } from 'marked';
import type { CodeBlockClipboard } from '../../codeBlockEnhancer';
import { enhanceCodeBlocks } from '../../codeBlockEnhancer';
import type { MarkdownRenderFn } from '../../MessageList';
import type { PlanMarkdownRenderFn } from '../../PlanApprovalDialog';

import { createElement, icons } from 'lucide';

const toPascal = (s: string): string =>
  s.replace(/(^|-)([a-z])/g, (_m, _p, c: string) => c.toUpperCase());

export function mockSetIcon(el: HTMLElement, name: string): void {
  const node = (icons as Record<string, unknown>)[toPascal(name)];
  if (!node) {
    el.textContent = `[${name}]`;
    return;
  }
  const svg = createElement(node as Parameters<typeof createElement>[0]);
  svg.classList.add('svg-icon', `lucide-${name}`);
  el.replaceChildren(svg);
}

export async function mockRenderMarkdown(el: HTMLElement, md: string): Promise<void> {
  el.textContent = md;
}

export function mockMatchMedia(query: string): MediaQueryList {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  };
}

export function makeContextSource(ctx: FocusedContext = NULL_FOCUSED_CONTEXT): ContextIndicatorSource {
  return {
    getContext: () => ctx,
    subscribe: () => () => {},
  };
}

export function makeIndexSource(hasIndex: boolean): IndexStatusSource {
  return {
    hasIndex: () => hasIndex,
    subscribe: () => () => {},
  };
}

export const exampleFocusedContext: FocusedContext = {
  file: 'Projects/Obsidian Plugin/docs/README.md',
  cursor: { line: 42, ch: 10 },
  selection: { from: { line: 40, ch: 0 }, to: { line: 45, ch: 12 } },
  viewport: { from: 30, to: 80, text: 'sample viewport text' },
};

export const exampleFocusedContextNoSelection: FocusedContext = {
  file: 'Daily Notes/2026-04-24.md',
  cursor: { line: 1, ch: 0 },
  selection: null,
  viewport: { from: 0, to: 20, text: '' },
};

export function makeMessageStore(records: readonly ChatMessageRecord[]): ChatMessageStore {
  const store = new ChatMessageStore();
  store.set(records);
  return store;
}

export function makePhaseSource(phase: StreamingPhase): PhaseSource {
  return {
    getPhase: () => phase,
    subscribe: () => () => {},
  };
}

export function makeQueueSource(length: number): QueueSource {
  return {
    getLength: () => length,
    subscribe: () => () => {},
  };
}

export function makeThreadsSource(snapshot: ThreadsSnapshot): ThreadsUiSource {
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    create: async () => 'thread-new',
    switch: async () => {},
    rename: async () => {},
    delete: async () => {},
  };
}

export const exampleThreadsSnapshot: ThreadsSnapshot = {
  activeId: 't1',
  summaries: [
    { id: 't1', title: 'Obsidian plugin design', updatedAt: '2026-04-24T09:10:00Z', messageCount: 12 },
    { id: 't2', title: 'Q2 roadmap brainstorm', updatedAt: '2026-04-23T16:40:00Z', messageCount: 8 },
    { id: 't3', title: 'Reading notes: Dune', updatedAt: '2026-04-22T21:00:00Z', messageCount: 3 },
  ],
};

export const mockClipboard: CodeBlockClipboard = {
  copy: async (_text: string) => {},
  notify: (_msg: string) => {},
};

marked.setOptions({ async: false, breaks: true, gfm: true });

function renderMd(container: HTMLElement, text: string): () => void {
  const html = marked.parse(text, { async: false }) as string;
  container.innerHTML = html;
  return enhanceCodeBlocks(container, { clipboard: mockClipboard, setIcon: mockSetIcon });
}

export const mockRenderMarkdownFn: MarkdownRenderFn = (text, container) => renderMd(container, text);

export const mockRenderPlanMarkdown: PlanMarkdownRenderFn = (container, plan) => renderMd(container, plan);

export const exampleConversation: readonly ChatMessageRecord[] = [
  {
    id: 'm1',
    role: 'user',
    content: 'Summarize my daily note for **2026-04-24** and list the TODOs.',
    createdAt: '2026-04-24T09:00:00Z',
  },
  {
    id: 'm2',
    role: 'assistant',
    content: [
      '### Summary',
      '',
      "Today you planned to add **Storybook** to the Leo plugin. You also captured a TODO to review the new skill registry.",
      '',
      '### TODOs',
      '',
      '- [ ] Wire real markdown renderer into Storybook',
      '- [ ] Review `skill-registry.md` in `.agent/standards`',
      '- [x] Install `@storybook/react-vite`',
    ].join('\n'),
    createdAt: '2026-04-24T09:00:02Z',
    status: 'done',
    tokens: { input: 120, output: 80, total: 200 },
  },
  {
    id: 'm3',
    role: 'user',
    content: 'Nice. Show me the minimal ChatRoot wiring.',
    createdAt: '2026-04-24T09:01:00Z',
  },
  {
    id: 'm4',
    role: 'assistant',
    content: [
      'Here is the minimum shape:',
      '',
      '```tsx',
      "import { ChatRoot } from '@/ui/chat/ChatRoot';",
      '',
      '<ChatRoot',
      '  messageStore={store}',
      '  renderMarkdown={render}',
      '  clipboard={clipboard}',
      '/>;',
      '```',
      '',
      'Everything else (`phaseSource`, `threadsSource`, …) is optional — the component falls back to idle/empty defaults.',
    ].join('\n'),
    createdAt: '2026-04-24T09:01:04Z',
    status: 'done',
    tokens: { input: 210, output: 140, total: 350 },
  },
];

export const streamingConversation: readonly ChatMessageRecord[] = [
  ...exampleConversation,
  {
    id: 'm5',
    role: 'user',
    content: 'Draft a release note for the Storybook addition.',
    createdAt: '2026-04-24T09:02:00Z',
  },
  {
    id: 'm6',
    role: 'assistant',
    content: 'Sure — drafting a release note now…',
    createdAt: '2026-04-24T09:02:02Z',
    status: 'streaming',
  },
];

export const bannerConversation: readonly ChatMessageRecord[] = [
  ...exampleConversation,
  {
    id: 'b1',
    role: 'banner',
    content: 'cancelled after 2 tools',
    createdAt: '2026-04-24T09:03:00Z',
    banner: { kind: 'cancelled', toolCount: 2 },
  },
];

export const contextWidgetConversation: readonly ChatMessageRecord[] = [
  ...exampleConversation,
  {
    id: 'm-ctx-user',
    role: 'user',
    content: '/context',
    createdAt: '2026-04-24T09:05:00Z',
  },
  {
    id: 'm-ctx-widget',
    role: 'widget',
    content: '',
    createdAt: '2026-04-24T09:05:00Z',
    widget: {
      kind: 'context',
      props: {
        contextWindow: 200_000,
        data: {
          systemTokens: 4_200,
          memoryFileTokens: 1_800,
          builtInToolTokens: 6_400,
          mcpToolTokens: 2_300,
          customAgentTokens: 1_200,
          slashCommandTokens: 0,
          messageTokens: 38_500,
          skillTokens: 900,
          skillCountFailed: false,
          totalTokens: 55_300,
          tokenTotalSource: 'api' as const,
          pipelineMessageCount: 18,
          model: 'claude-opus-4-7',
        },
      },
    },
  },
];

export const errorConversation: readonly ChatMessageRecord[] = [
  ...exampleConversation,
  {
    id: 'm-err-user',
    role: 'user',
    content: 'Generate the release notes for v0.4.',
    createdAt: '2026-04-24T09:04:00Z',
  },
  {
    id: 'm-err-assistant',
    role: 'assistant',
    content: 'Drafting release notes',
    createdAt: '2026-04-24T09:04:01Z',
    status: 'error',
  },
  {
    id: 'm-err-assistant:banner',
    role: 'banner',
    content: 'stream error: provider returned 503 Service Unavailable',
    createdAt: '2026-04-24T09:04:02Z',
    banner: { kind: 'error', message: 'provider returned 503 Service Unavailable' },
  },
];
