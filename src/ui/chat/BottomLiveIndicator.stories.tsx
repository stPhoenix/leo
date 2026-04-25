import type { Meta, StoryObj } from '@storybook/react-vite';
import { BottomLiveIndicator } from './BottomLiveIndicator';
import { ChatMessageStore } from '@/chat/messageStore';
import { RunStateStore } from '@/chat/runStateStore';
import type { StreamingPhase } from '@/chat/streamingController';
import type { ChatMessageRecord } from '@/chat/types';

function staticPhase(p: StreamingPhase): {
  getPhase: () => StreamingPhase;
  subscribe: () => () => void;
} {
  return { getPhase: () => p, subscribe: () => () => undefined };
}

function withMessage(record: ChatMessageRecord): ChatMessageStore {
  const s = new ChatMessageStore();
  s.set([record]);
  return s;
}

const baseAssistant: ChatMessageRecord = {
  id: 'a',
  role: 'assistant',
  content: '',
  createdAt: '2026-04-25T10:00:00Z',
  status: 'streaming',
  blocks: [{ type: 'text', text: 'thinking through this…' }],
};

const meta: Meta<typeof BottomLiveIndicator> = {
  title: 'Chat/BottomLiveIndicator',
  component: BottomLiveIndicator,
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof BottomLiveIndicator>;

export const Idle: Story = {
  args: {
    messageStore: new ChatMessageStore(),
    phaseSource: staticPhase('idle'),
  },
};

export const Thinking: Story = {
  args: {
    messageStore: withMessage(baseAssistant),
    phaseSource: staticPhase('streaming'),
  },
};

export const Reasoning: Story = {
  args: {
    messageStore: withMessage({
      ...baseAssistant,
      blocks: [{ type: 'thinking', thinking: 'reasoning…' }],
    }),
    phaseSource: staticPhase('streaming'),
  },
};

export const RunningSingleTool: Story = {
  args: {
    messageStore: new ChatMessageStore(),
    phaseSource: staticPhase('streaming'),
    runState: (() => {
      const rs = new RunStateStore();
      rs.markRunning('t1');
      return rs;
    })(),
    resolveToolName: () => 'Bash',
    onCancel: () => undefined,
  },
};

export const RunningMultiple: Story = {
  args: {
    messageStore: new ChatMessageStore(),
    phaseSource: staticPhase('streaming'),
    runState: (() => {
      const rs = new RunStateStore();
      rs.markRunning('t1');
      rs.markRunning('t2');
      rs.markRunning('t3');
      return rs;
    })(),
    resolveToolName: (id) => (id === 't1' ? 'Read' : id),
    onCancel: () => undefined,
  },
};

export const Stalled: Story = {
  args: {
    messageStore: withMessage(baseAssistant),
    phaseSource: staticPhase('streaming'),
    lastEventAtSource: () => 0,
    now: () => 14000,
    stalledThresholdMs: 10000,
    onCancel: () => undefined,
  },
};
