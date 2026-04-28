import type { Meta, StoryObj } from '@storybook/react-vite';
import { DiffView } from './DiffView';

const meta: Meta<typeof DiffView> = {
  title: 'Chat/Blocks/DiffView',
  component: DiffView,
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof DiffView>;

export const EditSmall: Story = {
  args: {
    before: 'const x = 1;\nconst y = 2;\nconst z = 4;',
    after: 'const x = 1;\nconst y = 3;\nconst z = 4;',
    path: 'notes/foo.md',
  },
};

export const EditLargeCollapsed: Story = {
  args: {
    before: Array.from({ length: 80 }, (_, i) => `l${i}`).join('\n'),
    after: Array.from({ length: 80 }, (_, i) => `L${i}`).join('\n'),
    path: 'notes/big.md',
  },
};

export const Create: Story = {
  args: {
    before: '',
    after: '# New note\n\nbody…\n',
    path: 'notes/new.md',
  },
};

export const Identical: Story = {
  args: { before: 'unchanged', after: 'unchanged' },
};
