import { createElement } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { ChatRoot } from './ChatRoot';
import { HeaderStat } from './HeaderStat';
import './widgets/ContextWidget';
import { DiffView, ProgressLines, type ToolUseBlockSlots } from './blocks';
import { RunStateStore } from '@/chat/runStateStore';
import type { ChatMessageRecord, ContentBlock, ToolUseBlock } from '@/chat/types';
import {
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
} from './__stories__/mocks/sources';

const EDIT_TOOLS = new Set(['edit_note', 'create_note', 'append_to_note', 'editNote']);

interface RunStateSeed {
  readonly running?: readonly string[];
  readonly resolved?: ReadonlyArray<readonly [string, unknown?]>;
  readonly errored?: readonly string[];
  readonly rejected?: readonly string[];
  readonly canceled?: readonly string[];
  readonly progress?: ReadonlyArray<
    readonly [string, Parameters<RunStateStore['appendProgress']>[1]]
  >;
  readonly permissions?: ReadonlyArray<
    readonly [string, Parameters<RunStateStore['recordPermissionRequest']>[1]]
  >;
}

function buildRunState(seed: RunStateSeed): RunStateStore {
  const rs = new RunStateStore();
  for (const id of seed.running ?? []) rs.markRunning(id);
  for (const [id, data] of seed.resolved ?? []) {
    rs.markRunning(id);
    rs.markResolved(id, false, data === undefined ? undefined : { ok: true, data });
  }
  for (const id of seed.errored ?? []) {
    rs.markRunning(id);
    rs.markResolved(id, true);
  }
  for (const id of seed.rejected ?? []) rs.markRejected(id);
  for (const id of seed.canceled ?? []) {
    rs.markRunning(id);
    rs.markCanceled(id);
  }
  for (const [id, ev] of seed.progress ?? []) rs.appendProgress(id, ev);
  for (const [id, req] of seed.permissions ?? []) rs.recordPermissionRequest(id, req);
  return rs;
}

function buildSlots(runState: RunStateStore): ToolUseBlockSlots {
  return {
    runState,
    renderProgress: (block) => createElement(ProgressLines, { toolUseId: block.id, runState }),
    renderResult: (block) => {
      if (!EDIT_TOOLS.has(block.name)) return null;
      const r = runState.getSnapshot().toolResults.get(block.id);
      if (r?.ok !== true) return null;
      const d = r.data as { before?: unknown; after?: unknown; path?: unknown };
      if (typeof d?.before !== 'string' || typeof d?.after !== 'string') return null;
      return createElement(DiffView, {
        before: d.before,
        after: d.after,
        ...(typeof d.path === 'string' ? { path: d.path } : {}),
      });
    },
  };
}

function tu(
  id: string,
  name: string,
  input: unknown,
  decision?: ToolUseBlock['decision'],
): ToolUseBlock {
  return {
    type: 'tool_use',
    id,
    name,
    input,
    ...(decision !== undefined ? { decision } : {}),
  };
}

function tr(toolUseId: string, content: string, isError = false): ContentBlock {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content,
    ...(isError ? { is_error: true } : {}),
  };
}

const userAsk = (id: string, text: string, at: string): ChatMessageRecord => ({
  id,
  role: 'user',
  content: text,
  createdAt: at,
});

// ===== Kitchen-sink assistant message: every block type, every status =====
const kitchenSinkBlocks: ContentBlock[] = [
  { type: 'text', text: 'Let me think this through and run a few tools.' },
  { type: 'thinking', thinking: 'Plan: read the README, then patch line 42, then verify.' },
  tu('grp1', 'readNote', { path: 'README.md' }),
  tu('grp2', 'readNote', { path: 'docs/plan.md' }),
  tu('grp3', 'readNote', { path: 'docs/notes.md' }),
  tr('grp1', '# Leo\nLocal-first plugin.'),
  tr('grp2', '## Plan\n- ship blocks\n- ship live status'),
  tr('grp3', 'misc notes'),
  { type: 'text', text: 'Now editing the README:' },
  tu('edit1', 'editNote', { path: 'README.md', oldText: 'const x = 1;', newText: 'const x = 2;' }),
  tr('edit1', '{"path":"README.md","bytesWritten":42}'),
  tu('err1', 'webSearch', { query: 'obsidian plugin api 2026' }),
  tr('err1', 'NetworkError: ECONNRESET', true),
  tu('rej1', 'editNote', { path: 'secrets.env', oldText: 'a', newText: 'b' }, 'deny'),
  tr('rej1', 'rejected by user'),
  tu('can1', 'webSearch', { query: 'long-running search' }),
  tr('can1', 'canceled'),
  { type: 'text', text: 'Done — see diff above.' },
];

const kitchenSinkConvo: readonly ChatMessageRecord[] = [
  userAsk('u1', 'Read the README and patch the version constant.', '2026-04-25T10:00:00Z'),
  {
    id: 'a1',
    role: 'assistant',
    content: '',
    createdAt: '2026-04-25T10:00:01Z',
    status: 'done',
    blocks: kitchenSinkBlocks,
    tokens: { input: 320, output: 480, total: 800 },
  },
];

const kitchenSinkRunState = buildRunState({
  resolved: [
    ['grp1'],
    ['grp2'],
    ['grp3'],
    [
      'edit1',
      {
        path: 'README.md',
        before: 'const x = 1;\nconst y = 2;\nconst z = 4;\n',
        after: 'const x = 2;\nconst y = 2;\nconst z = 4;\n',
      },
    ],
  ],
  errored: ['err1'],
  rejected: ['rej1'],
  canceled: ['can1'],
});

// ===== Live streaming: tool currently running with progress =====
const liveBlocks: ContentBlock[] = [
  { type: 'text', text: 'Searching the web for Obsidian API changes…' },
  tu('live1', 'webSearch', { query: 'obsidian.md plugin api 2026' }),
];

const liveConvo: readonly ChatMessageRecord[] = [
  userAsk('u2', 'Find any breaking changes in the latest Obsidian API.', '2026-04-25T10:01:00Z'),
  {
    id: 'a2',
    role: 'assistant',
    content: '',
    createdAt: '2026-04-25T10:01:01Z',
    status: 'streaming',
    blocks: liveBlocks,
  },
];

const liveRunState = buildRunState({
  running: ['live1'],
  progress: [
    [
      'live1',
      {
        kind: 'web_search',
        toolUseId: 'live1',
        query: 'obsidian.md plugin api 2026',
        resultsSoFar: 1,
      },
    ],
    [
      'live1',
      {
        kind: 'web_search',
        toolUseId: 'live1',
        query: 'obsidian.md plugin api 2026',
        resultsSoFar: 4,
      },
    ],
    [
      'live1',
      {
        kind: 'web_search',
        toolUseId: 'live1',
        query: 'obsidian.md plugin api 2026',
        resultsSoFar: 9,
      },
    ],
  ],
});

// ===== Pending permission: write tool blocked on user approval =====
const permissionBlocks: ContentBlock[] = [
  { type: 'text', text: 'I would like to write the new release notes file:' },
  tu('perm1', 'editNote', { path: 'CHANGELOG.md', oldText: '', newText: '## v0.4\n- live status' }),
];

const permissionConvo: readonly ChatMessageRecord[] = [
  userAsk('u3', 'Append release notes for v0.4 to CHANGELOG.md.', '2026-04-25T10:02:00Z'),
  {
    id: 'a3',
    role: 'assistant',
    content: '',
    createdAt: '2026-04-25T10:02:01Z',
    status: 'streaming',
    blocks: permissionBlocks,
  },
];

const permissionRunState = buildRunState({
  permissions: [
    [
      'perm1',
      {
        toolUseId: 'perm1',
        toolId: 'editNote',
        thread: 't1',
        argsJson: JSON.stringify({ path: 'CHANGELOG.md' }),
        category: 'write',
      },
    ],
  ],
});

// ===== Sub-agent progress tree =====
const agentBlocks: ContentBlock[] = [
  { type: 'text', text: 'Spinning up an Explore sub-agent to map the codebase.' },
  tu('agent1', 'Agent', { description: 'codebase map', subagent_type: 'Explore' }),
];

const agentConvo: readonly ChatMessageRecord[] = [
  userAsk('u4', 'Map the chat module — files, key types, entry points.', '2026-04-25T10:03:00Z'),
  {
    id: 'a4',
    role: 'assistant',
    content: '',
    createdAt: '2026-04-25T10:03:01Z',
    status: 'streaming',
    blocks: agentBlocks,
  },
];

const agentRunState = buildRunState({
  running: ['agent1'],
  progress: [
    [
      'agent1',
      { kind: 'agent', toolUseId: 'agent1', agentId: 'a1', agentType: 'Explore', toolUseCount: 1 },
    ],
    [
      'agent1',
      { kind: 'agent', toolUseId: 'agent1', agentId: 'a1', agentType: 'Explore', toolUseCount: 4 },
    ],
    [
      'agent1',
      { kind: 'agent', toolUseId: 'agent1', agentId: 'a2', agentType: 'Explore', toolUseCount: 2 },
    ],
  ],
});

// ===== Common args =====
const meta: Meta<typeof ChatRoot> = {
  title: 'Chat/ChatRoot · Blocks',
  component: ChatRoot,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Integrated ChatRoot with the F01–F12 block renderers wired through `toolUseSlots`. ' +
          'Each story seeds a `RunStateStore` so tool_use/tool_result blocks render with realistic status, ' +
          'progress lines, permission prompts, and unified diffs.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div
        style={{
          width: 480,
          height: 720,
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
    initialWidth: 480,
    renderMarkdown: mockRenderMarkdownFn,
    renderPlanMarkdown: mockRenderPlanMarkdown,
    clipboard: mockClipboard,
    setIcon: mockSetIcon,
    onOverflowMenu: fn(),
    onRevealContextFile: fn(),
    onCancelLive: fn(),
    queueSource: makeQueueSource(0),
    contextIndicatorSource: makeContextSource(exampleFocusedContext),
    headerStats: <HeaderStat variant="context" label="ctx" pct={42} detail="84.0k / 200k tokens" />,
    threadsSource: makeThreadsSource(exampleThreadsSnapshot),
    indexStatusSource: makeIndexSource(true),
    messageActions: { copy: fn(), delete: fn(), regenerate: fn(), editAndResend: fn() },
    composer: {
      onSubmit: fn(),
      onStopIntent: fn(),
      onOpenCommandPalette: fn(),
      slashCommands: [],
    },
  },
};
export default meta;

type Story = StoryObj<typeof ChatRoot>;

export const AllBlockTypes: Story = {
  args: {
    messageStore: makeMessageStore(kitchenSinkConvo),
    phaseSource: makePhaseSource('idle'),
    toolUseSlots: buildSlots(kitchenSinkRunState),
    liveIndicatorRunState: kitchenSinkRunState,
    resolveToolName: (id) => {
      for (const m of kitchenSinkConvo) {
        for (const b of m.blocks ?? []) {
          if (b.type === 'tool_use' && b.id === id) return b.name;
        }
      }
      return id;
    },
  },
};

export const LiveStreamingTool: Story = {
  args: {
    messageStore: makeMessageStore(liveConvo),
    phaseSource: makePhaseSource('streaming'),
    queueSource: makeQueueSource(1),
    toolUseSlots: buildSlots(liveRunState),
    liveIndicatorRunState: liveRunState,
    lastEventAtSource: () => Date.now() - 800,
    resolveToolName: (id) => (id === 'live1' ? 'webSearch' : id),
  },
};

export const PendingPermission: Story = {
  args: {
    messageStore: makeMessageStore(permissionConvo),
    phaseSource: makePhaseSource('streaming'),
    toolUseSlots: buildSlots(permissionRunState),
    liveIndicatorRunState: permissionRunState,
    resolveToolName: (id) => (id === 'perm1' ? 'editNote' : id),
  },
};

export const SubAgentProgress: Story = {
  args: {
    messageStore: makeMessageStore(agentConvo),
    phaseSource: makePhaseSource('streaming'),
    toolUseSlots: buildSlots(agentRunState),
    liveIndicatorRunState: agentRunState,
    resolveToolName: (id) => (id === 'agent1' ? 'Agent' : id),
  },
};

export const StalledStream: Story = {
  args: {
    messageStore: makeMessageStore(liveConvo),
    phaseSource: makePhaseSource('streaming'),
    toolUseSlots: buildSlots(liveRunState),
    liveIndicatorRunState: liveRunState,
    lastEventAtSource: () => Date.now() - 15_000,
    resolveToolName: (id) => (id === 'live1' ? 'webSearch' : id),
  },
};

// ===== Persistent post-turn view: every block auto-collapsed =====
const persistentBlocks: ContentBlock[] = [
  { type: 'text', text: "I'll plan, read the code, then patch the version." },
  {
    type: 'thinking',
    thinking:
      'Plan:\n1. Read README.md to find the version constant.\n2. Confirm callers.\n3. Patch line 42.\n4. Run tests.',
  },
  tu('p-read', 'readNote', { path: 'README.md' }),
  tr('p-read', '# Leo\n\nLocal-first plugin.\n\nVersion: 0.3.1'),
  { type: 'text', text: 'Found it. Patching now:' },
  tu('p-edit', 'editNote', { path: 'README.md' }),
  tr('p-edit', '{"path":"README.md","bytesWritten":24}'),
  { type: 'text', text: 'Verified — version is now 0.4.0.' },
];

const persistentConvo: readonly ChatMessageRecord[] = [
  userAsk('u-p', 'Bump README version to 0.4.0.', '2026-04-26T09:00:00Z'),
  {
    id: 'a-p',
    role: 'assistant',
    content: '',
    createdAt: '2026-04-26T09:00:02Z',
    status: 'done',
    blocks: persistentBlocks,
    tokens: { input: 480, output: 640, total: 1120 },
  },
];

const persistentRunState = buildRunState({
  resolved: [
    ['p-read'],
    [
      'p-edit',
      {
        path: 'README.md',
        before: '# Leo\n\nLocal-first plugin.\n\nVersion: 0.3.1\n',
        after: '# Leo\n\nLocal-first plugin.\n\nVersion: 0.4.0\n',
      },
    ],
  ],
});

export const PersistentPostTurn: Story = {
  name: 'Persistent post-turn (everything auto-collapsed)',
  parameters: {
    docs: {
      description: {
        story:
          "After a turn completes, tool_use blocks fold to one-liners and thinking folds to a 'Thinking · N chars' header. " +
          'Click any chevron to expand. ToolResult panels are not rendered separately because the editNote slot ' +
          'shows the diff inline; the legacy tool_result blocks are kept in the data for replay.',
      },
    },
  },
  args: {
    messageStore: makeMessageStore(persistentConvo),
    phaseSource: makePhaseSource('idle'),
    toolUseSlots: buildSlots(persistentRunState),
    liveIndicatorRunState: persistentRunState,
    resolveToolName: (id) => {
      for (const m of persistentConvo) {
        for (const b of m.blocks ?? []) {
          if (b.type === 'tool_use' && b.id === id) return b.name;
        }
      }
      return id;
    },
  },
};
