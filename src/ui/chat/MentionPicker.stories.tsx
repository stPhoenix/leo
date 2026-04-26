import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { MentionPicker } from './MentionPicker';
import { makeMentionItem, mockSetIcon } from './__stories__/mocks/sources';

const items = [
  makeMentionItem('README.md', [0, 1, 2, 3]),
  makeMentionItem('Projects/leo/CLAUDE.md', []),
  makeMentionItem('Daily Notes/2026-04-26.md', []),
  makeMentionItem('assets/diagram.png', [], 'image'),
  makeMentionItem('docs/spec/release-notes.md', []),
];

const meta: Meta<typeof MentionPicker> = {
  title: 'Chat/MentionPicker',
  component: MentionPicker,
  args: {
    items,
    activeIndex: 0,
    onSelect: fn(),
    onHover: fn(),
    setIcon: mockSetIcon,
  },
};
export default meta;

type Story = StoryObj<typeof MentionPicker>;

export const Default: Story = {};

export const SecondActive: Story = { args: { activeIndex: 1 } };

export const FilteredOne: Story = {
  args: {
    items: [makeMentionItem('Projects/leo/CLAUDE.md', [13, 14, 15, 16, 17])],
    activeIndex: 0,
  },
};

export const Empty: Story = { args: { items: [] } };

export const LongPath: Story = {
  args: {
    items: [
      makeMentionItem(
        'a/very/deeply/nested/folder/structure/inside/the/vault/notes/long-filename.md',
        [],
      ),
    ],
  },
};
