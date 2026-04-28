import { createElement } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ToolUseBlockView } from './ToolUseBlockView';
import { ProgressLines } from './ProgressLines';
import { DiffView } from './DiffView';
import { RunStateStore } from '@/chat/runStateStore';
import type { ToolUseBlock } from '@/chat/types';

function makeBlock(over: Partial<ToolUseBlock> = {}): ToolUseBlock {
  return { type: 'tool_use', id: 'tA', name: 'Bash', input: { cmd: 'ls -la' }, ...over };
}

function withRunState(setup: (rs: RunStateStore) => void): RunStateStore {
  const rs = new RunStateStore();
  setup(rs);
  return rs;
}

const meta: Meta<typeof ToolUseBlockView> = {
  title: 'Chat/Blocks/ToolUseBlockView',
  component: ToolUseBlockView,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A tool_use block. Auto-collapses once the tool reaches a terminal status ' +
          '(success/errored/rejected/canceled) so completed turns persist as compact one-liners; ' +
          'click the chevron to expand and inspect args/progress/result.',
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof ToolUseBlockView>;

// ── Live (auto-expanded) states ──────────────────────────────────────────

export const Queued: Story = {
  name: 'Live · queued (auto-expanded)',
  args: { block: makeBlock(), slots: { runState: new RunStateStore() } },
};

export const RunningBash: Story = {
  name: 'Live · running (auto-expanded)',
  args: {
    block: makeBlock(),
    slots: { runState: withRunState((rs) => rs.markRunning('tA')) },
  },
};

// ── Persistent (auto-collapsed) states ───────────────────────────────────

export const SuccessCollapsed: Story = {
  name: 'Persistent · success (auto-collapsed)',
  args: {
    block: makeBlock(),
    slots: {
      runState: withRunState((rs) => {
        rs.markRunning('tA');
        rs.markResolved('tA', false);
      }),
    },
  },
};

export const SuccessExpanded: Story = {
  name: 'Persistent · success (force-expanded)',
  args: {
    block: makeBlock(),
    defaultCollapsed: false,
    slots: {
      runState: withRunState((rs) => {
        rs.markRunning('tA');
        rs.markResolved('tA', false);
      }),
    },
  },
};

export const ErroredCollapsed: Story = {
  name: 'Persistent · errored (auto-collapsed)',
  args: {
    block: makeBlock(),
    slots: {
      runState: withRunState((rs) => {
        rs.markRunning('tA');
        rs.markResolved('tA', true);
      }),
    },
  },
};

export const RejectedCollapsed: Story = {
  name: 'Persistent · rejected (auto-collapsed)',
  args: {
    block: makeBlock({ decision: 'deny' }),
    slots: { runState: new RunStateStore() },
  },
};

export const CanceledCollapsed: Story = {
  name: 'Persistent · canceled (auto-collapsed)',
  args: {
    block: makeBlock(),
    slots: {
      runState: withRunState((rs) => {
        rs.markRunning('tA');
        rs.markCanceled('tA');
      }),
    },
  },
};

// ── With body slots (permission, progress, diff) ─────────────────────────

const editArgs = { path: 'README.md', oldText: 'const x = 1;', newText: 'const x = 2;' };

export const WithDiffExpanded: Story = {
  name: 'With diff · expanded',
  args: {
    block: makeBlock({ id: 'edit1', name: 'editNote', input: editArgs }),
    defaultCollapsed: false,
    slots: {
      runState: withRunState((rs) => {
        rs.markRunning('edit1');
        rs.markResolved('edit1', false, {
          ok: true,
          data: {
            path: 'README.md',
            before: 'const x = 1;\nconst y = 2;\n',
            after: 'const x = 2;\nconst y = 2;\n',
          },
        });
      }),
      renderResult: (b) => {
        const d = (b.input ?? {}) as Record<string, unknown>;
        return createElement(DiffView, {
          before: 'const x = 1;\nconst y = 2;\n',
          after: 'const x = 2;\nconst y = 2;\n',
          path: typeof d.path === 'string' ? d.path : 'README.md',
        });
      },
    },
  },
};

export const WithDiffCollapsed: Story = {
  name: 'With diff · collapsed (one-liner)',
  args: {
    block: makeBlock({ id: 'edit1', name: 'editNote', input: editArgs }),
    slots: {
      runState: withRunState((rs) => {
        rs.markRunning('edit1');
        rs.markResolved('edit1', false);
      }),
      renderResult: () =>
        createElement(DiffView, {
          before: 'const x = 1;\nconst y = 2;\n',
          after: 'const x = 2;\nconst y = 2;\n',
          path: 'README.md',
        }),
    },
  },
};

const progressRunState = (() => {
  const rs = new RunStateStore();
  rs.markRunning('srch');
  rs.appendProgress('srch', {
    kind: 'web_search',
    toolUseId: 'srch',
    query: 'obsidian plugin api',
    resultsSoFar: 1,
  });
  rs.appendProgress('srch', {
    kind: 'web_search',
    toolUseId: 'srch',
    query: 'obsidian plugin api',
    resultsSoFar: 4,
  });
  return rs;
})();

export const WithProgressExpanded: Story = {
  name: 'With progress · running web search',
  args: {
    block: makeBlock({ id: 'srch', name: 'webSearch', input: { query: 'obsidian plugin api' } }),
    slots: {
      runState: progressRunState,
      renderProgress: (b) =>
        createElement(ProgressLines, { toolUseId: b.id, runState: progressRunState }),
    },
  },
};

// ── Edge cases ───────────────────────────────────────────────────────────

export const ParseFailureArgs: Story = {
  args: {
    block: makeBlock({ raw: '{"path": "x' }),
  },
};

export const CustomArgsRenderer: Story = {
  args: {
    block: makeBlock({ name: 'editNote', input: { path: 'foo.md', lineStart: 12, lineEnd: 18 } }),
    slots: {
      renderArgs: (b) => {
        const i = b.input as { path: string; lineStart: number; lineEnd: number };
        return (
          <span data-slot="custom-args">
            path: {i.path}, lines: {i.lineStart}–{i.lineEnd}
          </span>
        );
      },
    },
  },
};
