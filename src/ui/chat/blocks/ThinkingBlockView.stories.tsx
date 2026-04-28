import type { Meta, StoryObj } from '@storybook/react-vite';
import { ThinkingBlockView } from './ThinkingBlockView';

const meta: Meta<typeof ThinkingBlockView> = {
  title: 'Chat/Blocks/ThinkingBlockView',
  component: ThinkingBlockView,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Reasoning/thinking output. Auto-collapses once the turn ends so persistent ' +
          'transcripts stay tidy; click ▸ to expand. Streams open while the model is reasoning.',
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof ThinkingBlockView>;

export const ExpandedStreaming: Story = {
  args: {
    block: {
      type: 'thinking',
      thinking:
        'I should read the file first, then look at the diff. The user wants me to handle the edge case where…',
    },
    streaming: true,
  },
};

export const CollapsedFinalised: Story = {
  args: {
    block: {
      type: 'thinking',
      thinking:
        'Long finalised reasoning text…\n'.repeat(8) +
        'Final answer: route through the aggregator.',
    },
    streaming: false,
  },
};

export const ExpandedFinalisedUser: Story = {
  args: {
    block: { type: 'thinking', thinking: 'Reasoning user toggled open.' },
    streaming: false,
  },
};

export const Redacted: Story = {
  args: {
    block: { type: 'redacted_thinking', data: 'x'.repeat(1234) },
    streaming: false,
  },
};
