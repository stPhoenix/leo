import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, within } from 'storybook/test';
import { ChatRoot } from './ChatRoot';
import { HeaderStat } from './HeaderStat';
import './widgets/ContextWidget';
import {
  bannerConversation,
  contextWidgetConversation,
  errorConversation,
  exampleConversation,
  exampleFocusedContext,
  exampleThreadsSnapshot,
  makeContextSource,
  makeIndexSource,
  makeMessageStore,
  makePhaseSource,
  makeQueueSource,
  makeThreadsSource,
  mockClipboard,
  mockRenderMarkdownFn,
  mockRenderPlanMarkdown,
  mockSetIcon,
  streamingConversation,
} from './__stories__/mocks/sources';

const meta: Meta<typeof ChatRoot> = {
  title: 'Chat/ChatRoot',
  component: ChatRoot,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div
        style={{
          width: 420,
          height: 640,
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid var(--background-modifier-border)',
          borderRadius: 8,
          overflow: 'hidden',
          background: 'var(--background-primary)',
          fontFamily: 'var(--font-interface)',
          color: 'var(--text-normal)',
        }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    initialWidth: 420,
    renderMarkdown: mockRenderMarkdownFn,
    renderPlanMarkdown: mockRenderPlanMarkdown,
    clipboard: mockClipboard,
    setIcon: mockSetIcon,
    onOverflowMenu: fn(),
    onRevealContextFile: fn(),
    onIndexVault: fn(),
    phaseSource: makePhaseSource('idle'),
    queueSource: makeQueueSource(0),
    contextIndicatorSource: makeContextSource(exampleFocusedContext),
    headerStats: (
      <>
        <HeaderStat variant="context" label="ctx" pct={28} detail="55.3k / 200k tokens" />
        <HeaderStat variant="index" label="idx" pct={100} detail="1,284 files indexed" />
      </>
    ),
    threadsSource: makeThreadsSource(exampleThreadsSnapshot),
    indexStatusSource: makeIndexSource(true),
    messageActions: {
      copy: fn(),
      delete: fn(),
      regenerate: fn(),
      editAndResend: fn(),
    },
    composer: {
      onSubmit: fn(),
      onStopIntent: fn(),
      onOpenCommandPalette: fn(),
      slashCommands: [
        { name: 'clear', description: 'Clear the current thread' },
        { name: 'plan', description: 'Start planning mode' },
        { name: 'context', description: 'Show the focused editor context' },
      ],
    },
  },
};
export default meta;

type Story = StoryObj<typeof ChatRoot>;

export const EmptyThread: Story = {
  args: { messageStore: makeMessageStore([]) },
};

export const Conversation: Story = {
  args: { messageStore: makeMessageStore(exampleConversation) },
};

export const Streaming: Story = {
  args: {
    messageStore: makeMessageStore(streamingConversation),
    phaseSource: makePhaseSource('streaming'),
  },
};

export const WithQueue: Story = {
  args: {
    messageStore: makeMessageStore(streamingConversation),
    phaseSource: makePhaseSource('streaming'),
    queueSource: makeQueueSource(2),
  },
};

export const CancelledBanner: Story = {
  args: { messageStore: makeMessageStore(bannerConversation) },
};

export const ErrorBanner: Story = {
  args: { messageStore: makeMessageStore(errorConversation) },
};

export const ContextCommandResult: Story = {
  args: { messageStore: makeMessageStore(contextWidgetConversation) },
};

export const HeaderStatsIndexing: Story = {
  args: {
    messageStore: makeMessageStore(exampleConversation),
    headerStats: (
      <>
        <HeaderStat variant="context" label="ctx" pct={82} detail="164k / 200k tokens" />
        <HeaderStat variant="index" label="idx" pct={37} detail="indexing 471 / 1,284 files" busy />
      </>
    ),
  },
};

export const HeaderStatsCritical: Story = {
  args: {
    messageStore: makeMessageStore(exampleConversation),
    headerStats: (
      <>
        <HeaderStat variant="context" label="ctx" pct={94} detail="188k / 200k tokens" />
        <HeaderStat variant="index" label="idx" pct={100} detail="1,284 files indexed" />
      </>
    ),
  },
};

export const SlashPickerOpen: Story = {
  args: { messageStore: makeMessageStore(exampleConversation) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const textarea = (await canvas.findByPlaceholderText('Type a message…')) as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    )?.set;
    setter?.call(textarea, '/');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
  },
};

export const IndexNotBuilt: Story = {
  args: {
    messageStore: makeMessageStore(exampleConversation),
    indexStatusSource: makeIndexSource(false),
  },
};

export const NoFocusedFile: Story = {
  args: {
    messageStore: makeMessageStore(exampleConversation),
    contextIndicatorSource: makeContextSource(),
  },
};

export const CollapsedNarrow: Story = {
  args: { initialWidth: 280, messageStore: makeMessageStore(exampleConversation) },
  decorators: [
    (Story) => (
      <div
        style={{
          width: 280,
          height: 560,
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid var(--background-modifier-border)',
          borderRadius: 8,
          overflow: 'hidden',
          background: 'var(--background-primary)',
          fontFamily: 'var(--font-interface)',
          color: 'var(--text-normal)',
        }}
      >
        <Story />
      </div>
    ),
  ],
};
