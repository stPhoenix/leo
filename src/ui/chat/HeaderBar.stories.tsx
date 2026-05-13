import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { HeaderBar } from './HeaderBar';
import { HeaderStat } from './HeaderStat';
import { TemperatureSlider } from './TemperatureSlider';
import { mockSetIcon } from './__stories__/mocks/sources';

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

export const WithTemperature: Story = {
  args: {
    stats: <HeaderStat variant="context" label="ctx" pct={28} detail="55.3k / 200k tokens" />,
    temperature: (
      <TemperatureSlider value={0.7} onChange={fn()} onCommit={fn()} setIcon={mockSetIcon} />
    ),
  },
};
