import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { HeaderBar } from './HeaderBar';

const meta: Meta<typeof HeaderBar> = {
  title: 'Chat/HeaderBar',
  component: HeaderBar,
  args: {
    collapsed: false,
    onOverflowMenu: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof HeaderBar>;

export const Default: Story = {};

export const Collapsed: Story = { args: { collapsed: true } };

export const WithThread: Story = {
  args: {
    threadSwitcher: <span className="leo-thread-switcher">Thread: Main</span>,
  },
};
