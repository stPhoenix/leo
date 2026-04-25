import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { ContextIndicator } from './ContextIndicator';
import {
  exampleFocusedContext,
  exampleFocusedContextNoSelection,
  makeContextSource,
} from './__stories__/mocks/sources';

const meta: Meta<typeof ContextIndicator> = {
  title: 'Chat/ContextIndicator',
  component: ContextIndicator,
  args: {
    collapsed: false,
    onReveal: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof ContextIndicator>;

export const NoFile: Story = {
  args: { source: makeContextSource() },
};

export const FileWithSelection: Story = {
  args: { source: makeContextSource(exampleFocusedContext) },
};

export const FileNoSelection: Story = {
  args: { source: makeContextSource(exampleFocusedContextNoSelection) },
};

export const CollapsedWithFile: Story = {
  args: { collapsed: true, source: makeContextSource(exampleFocusedContext) },
};

export const CollapsedNoFile: Story = {
  args: { collapsed: true, source: makeContextSource() },
};
