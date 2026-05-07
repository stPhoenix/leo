import type { Meta, StoryObj } from '@storybook/react-vite';
import { SlashExpandedBlockView } from './SlashExpandedBlock';

const meta: Meta<typeof SlashExpandedBlockView> = {
  title: 'Chat/Blocks/SlashExpandedBlock',
  component: SlashExpandedBlockView,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Collapsible reveal of the expanded prompt body that a slash command (e.g. `/foo`) ' +
          'sent to the LLM. The user message bubble keeps the typed text (`/foo args`) visible; ' +
          'this block sits underneath, collapsed by default, so users can inspect what was ' +
          'actually sent without having a wall of markdown crowd the chat.',
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof SlashExpandedBlockView>;

const renderMarkdown = (text: string, container: HTMLElement): (() => void) => {
  const pre = container.ownerDocument.createElement('pre');
  pre.style.whiteSpace = 'pre-wrap';
  pre.style.fontFamily = 'var(--font-monospace)';
  pre.style.fontSize = 'var(--font-ui-smaller)';
  pre.style.margin = '0';
  pre.textContent = text;
  container.appendChild(pre);
  return (): void => {
    container.replaceChildren();
  };
};

const longBody = [
  '# Plan the feature',
  '',
  'You are operating in plan mode. Slice the SRS into vertically integrated features.',
  '',
  '## Phase 1: analyze',
  '- Read `.agent/srs/*.md`',
  '- Identify cross-cutting concerns',
  '',
  '## Phase 2: slice',
  '- Each feature must be implementable independently',
  '- Document acceptance criteria',
  '',
  'Repeat for every feature in the SRS.',
].join('\n');

export const CollapsedShortPrompt: Story = {
  args: {
    block: {
      type: 'slash_expanded',
      command: 'foo',
      typed: '/foo bar',
      expandedBody: 'Run the foo workflow with argument: bar.',
    },
    blockId: 'story-collapsed-short',
    renderMarkdown,
  },
};

export const CollapsedLongMarkdownPrompt: Story = {
  args: {
    block: {
      type: 'slash_expanded',
      command: 'plan-feature',
      typed: '/plan-feature',
      expandedBody: longBody,
    },
    blockId: 'story-collapsed-long',
    renderMarkdown,
  },
};

export const WithMarkerXml: Story = {
  args: {
    block: {
      type: 'slash_expanded',
      command: 'review',
      typed: '/review PR-42',
      expandedBody:
        '<command-name>review</command-name>\n<command-args>PR-42</command-args>\n\n# Review the pull request\n\nFollow the project review checklist.',
    },
    blockId: 'story-marker-xml',
    renderMarkdown,
  },
};

export const FallbackNoMarkdown: Story = {
  args: {
    block: {
      type: 'slash_expanded',
      command: 'foo',
      typed: '/foo',
      expandedBody: 'Plain text body rendered via fallback <pre> when no renderMarkdown supplied.',
    },
    blockId: 'story-fallback',
  },
};
