import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { SlashPicker, type SlashPickerItem } from './SlashPicker';

const items: readonly SlashPickerItem[] = [
  { name: 'clear', description: 'Clear the current thread', matches: [1, 2] },
  { name: 'plan', description: 'Enter planning mode', matches: [] },
  { name: 'context', description: 'Show the focused context', matches: [] },
  { name: 'thread', description: 'Switch or create a thread', matches: [] },
];

const meta: Meta<typeof SlashPicker> = {
  title: 'Chat/SlashPicker',
  component: SlashPicker,
  args: {
    items,
    activeIndex: 0,
    onSelect: fn(),
    onHover: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof SlashPicker>;

export const Default: Story = {};

export const SecondActive: Story = { args: { activeIndex: 1 } };

export const FilteredOne: Story = {
  args: {
    items: [{ name: 'clear', description: 'Clear the current thread', matches: [1, 2, 3] }],
  },
};

export const ManyCommands: Story = {
  args: {
    items: [
      ...items,
      { name: 'skill', description: 'Invoke a skill', matches: [] },
      { name: 'help', description: 'Show help', matches: [] },
      { name: 'model', description: 'Switch model', matches: [] },
      { name: 'debug', description: 'Toggle debug mode', matches: [] },
    ],
  },
};
