import type { Meta, StoryObj } from '@storybook/react-vite';
import { AgentProgressTree } from './AgentProgressTree';

const meta: Meta<typeof AgentProgressTree> = {
  title: 'Chat/Blocks/AgentProgressTree',
  component: AgentProgressTree,
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof AgentProgressTree>;

export const SingleInitializing: Story = {
  args: {
    events: [
      {
        kind: 'agent',
        toolUseId: 't',
        agentId: 'a',
        agentType: 'Explore',
        toolUseCount: 0,
      },
    ],
  },
};

export const SingleActive: Story = {
  args: {
    events: [
      {
        kind: 'agent',
        toolUseId: 't',
        agentId: 'a',
        agentType: 'Explore',
        toolUseCount: 7,
        tokens: 4200,
        lastToolInfo: 'Read src/main.ts',
      },
    ],
  },
};

export const SingleDone: Story = {
  args: {
    events: [
      {
        kind: 'agent',
        toolUseId: 't',
        agentId: 'a',
        agentType: 'Explore',
        toolUseCount: 12,
        tokens: 9100,
        isResolved: true,
      },
    ],
  },
};

export const ThreeAgentsMixed: Story = {
  args: {
    events: [
      {
        kind: 'agent',
        toolUseId: 't',
        agentId: 'a',
        agentType: 'Plan',
        toolUseCount: 2,
        tokens: 800,
      },
      {
        kind: 'agent',
        toolUseId: 't',
        agentId: 'b',
        agentType: 'Code',
        toolUseCount: 5,
        tokens: 3100,
        lastToolInfo: 'Edit src/foo.ts',
      },
      {
        kind: 'agent',
        toolUseId: 't',
        agentId: 'c',
        agentType: 'Test',
        toolUseCount: 4,
        tokens: 1400,
        isResolved: true,
      },
    ],
  },
};

export const ErroredAgent: Story = {
  args: {
    events: [
      {
        kind: 'agent',
        toolUseId: 't',
        agentId: 'a',
        agentType: 'Explore',
        toolUseCount: 3,
        tokens: 2000,
        isResolved: true,
        isError: true,
      },
    ],
  },
};
