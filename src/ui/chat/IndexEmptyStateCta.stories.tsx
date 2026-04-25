import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { IndexEmptyStateCta } from './IndexEmptyStateCta';
import { makeIndexSource } from './__stories__/mocks/sources';

const meta: Meta<typeof IndexEmptyStateCta> = {
  title: 'Chat/IndexEmptyStateCta',
  component: IndexEmptyStateCta,
  args: {
    onIndexVault: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof IndexEmptyStateCta>;

export const VaultNotIndexed: Story = {
  args: { source: makeIndexSource(false) },
};

export const VaultIndexed: Story = {
  args: { source: makeIndexSource(true) },
  parameters: {
    docs: { description: { story: 'Renders nothing when the vault is already indexed.' } },
  },
};
