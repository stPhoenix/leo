import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import type {
  ClarifyingQuestionOutcome,
  ClarifyingQuestionRequest,
  PendingClarifyingQuestion,
} from '@/agent/clarifyingQuestionController';
import {
  ClarifyingQuestionDialog,
  type ClarifyingQuestionSource,
} from './ClarifyingQuestionDialog';

function makeStaticSource(
  request: ClarifyingQuestionRequest | null,
  onResolve: (outcome: ClarifyingQuestionOutcome) => void = () => undefined,
): ClarifyingQuestionSource {
  const pending: PendingClarifyingQuestion | null =
    request === null ? null : { request, resolve: onResolve };
  return {
    current: () => pending,
    subscribe: () => () => undefined,
    resolve: onResolve,
  };
}

const meta: Meta<typeof ClarifyingQuestionDialog> = {
  title: 'Chat/ClarifyingQuestionDialog',
  component: ClarifyingQuestionDialog,
};
export default meta;

type Story = StoryObj<typeof ClarifyingQuestionDialog>;

export const HiddenWhenNoPending: Story = {
  args: { source: makeStaticSource(null) },
  parameters: {
    docs: {
      description: { story: 'No pending question — dialog renders hidden placeholder div.' },
    },
  },
};

export const SingleSelectTwoOptions: Story = {
  args: {
    source: makeStaticSource(
      {
        threadId: 't-storybook',
        question:
          'Should the chapters live as folders with sub-notes, or as flat files with frontmatter ordering?',
        header: 'Structure',
        options: ['folders', 'flat'],
      },
      fn(),
    ),
  },
};

export const SingleSelectFourOptions: Story = {
  args: {
    source: makeStaticSource(
      {
        threadId: 't-storybook',
        question: 'Which folder should the new project hub live in?',
        header: 'Location',
        options: ['Areas/Projects', 'Projects', 'Vault root', 'Daily/Active'],
      },
      fn(),
    ),
  },
};

export const MultiSelect: Story = {
  args: {
    source: makeStaticSource(
      {
        threadId: 't-storybook',
        question: 'Which tags should the hub note carry?',
        header: 'Tags',
        options: ['#hub', '#project', '#dissertation', '#research'],
        multiSelect: true,
      },
      fn(),
    ),
  },
};

export const FreeformOnly: Story = {
  args: {
    source: makeStaticSource(
      {
        threadId: 't-storybook',
        question: 'What should the hub note be titled?',
        header: 'Naming',
      },
      fn(),
    ),
  },
};
