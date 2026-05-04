import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, within, userEvent } from 'storybook/test';
import { useEffect, useState } from 'react';
import {
  InlineConfirmation,
  type InlineConfirmationSource,
  buildConfirmationRequest,
} from './InlineConfirmation';
import type { ConfirmationDecision, PendingConfirmation } from '@/agent/confirmationController';

const WRITE_REQ = buildConfirmationRequest({
  toolId: 'editNote',
  thread: 't-1',
  argsJson: JSON.stringify({
    path: 'CHANGELOG.md',
    oldText: '',
    newText: '## v0.4\n- live status\n- /rag widget\n',
  }),
  category: 'write',
});

const READ_REQ = buildConfirmationRequest({
  toolId: 'readFile',
  thread: 't-1',
  argsJson: JSON.stringify({ path: 'src/agent/agentRunner.ts', maxBytes: 32_000 }),
  category: 'read',
});

const LARGE_REQ = buildConfirmationRequest({
  toolId: 'editNote',
  thread: 't-1',
  argsJson: JSON.stringify({
    path: 'docs/runbook.md',
    oldText: 'placeholder',
    newText: Array.from({ length: 24 }, (_, i) => `Line ${i + 1}: replacement content`).join('\n'),
  }),
  category: 'write',
});

function staticSource(
  request: typeof WRITE_REQ | null,
  onResolve: (d: ConfirmationDecision) => void = () => undefined,
): InlineConfirmationSource {
  const pending: PendingConfirmation | null =
    request === null ? null : { request, resolve: onResolve };
  return {
    current: () => pending,
    subscribe: () => () => undefined,
    resolve: onResolve,
  };
}

interface AppliedBannerProps {
  readonly decision: ConfirmationDecision;
}

function pickToneBackground(tone: 'rejected' | 'allow-thread' | 'allow-once'): string {
  if (tone === 'rejected') return 'var(--text-error)';
  if (tone === 'allow-thread') return 'var(--interactive-accent)';
  return 'var(--color-green, var(--interactive-accent))';
}

function AppliedBanner(props: AppliedBannerProps): JSX.Element {
  const { decision } = props;
  let tone: 'rejected' | 'allow-thread' | 'allow-once';
  let label: string;
  if (decision === 'deny') {
    tone = 'rejected';
    label = 'Tool rejected';
  } else if (decision === 'allow-thread') {
    tone = 'allow-thread';
    label = 'Allowed for thread — tool applied';
  } else {
    tone = 'allow-once';
    label = 'Allowed once — tool applied';
  }
  return (
    <div
      data-region="confirmation-applied"
      data-decision={decision}
      style={{
        margin: 'var(--size-4-2)',
        padding: 'var(--size-4-2) var(--size-4-3)',
        border: '1px solid var(--background-modifier-border)',
        borderRadius: 'var(--radius-m)',
        background: 'var(--background-primary)',
        boxShadow: 'var(--shadow-s)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--size-4-2)',
        fontSize: 'var(--font-ui-small)',
        color: tone === 'rejected' ? 'var(--text-error)' : 'var(--text-muted)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: pickToneBackground(tone),
        }}
      />
      {label}
    </div>
  );
}

function AfterAppliedHarness(props: {
  readonly initialRequest: typeof WRITE_REQ;
  readonly autoResolveAfterMs?: number;
  readonly autoDecision?: ConfirmationDecision;
}): JSX.Element {
  const { initialRequest, autoResolveAfterMs = 800, autoDecision = 'allow-once' } = props;
  const [pending, setPending] = useState<PendingConfirmation | null>({
    request: initialRequest,
    resolve: () => undefined,
  });
  const [last, setLast] = useState<ConfirmationDecision | null>(null);

  useEffect(() => {
    if (pending === null) return;
    const t = setTimeout(() => {
      setLast(autoDecision);
      setPending(null);
    }, autoResolveAfterMs);
    return () => clearTimeout(t);
  }, [pending, autoResolveAfterMs, autoDecision]);

  const source: InlineConfirmationSource = {
    current: () => pending,
    subscribe: () => () => undefined,
    resolve: (d) => {
      setLast(d);
      setPending(null);
    },
  };

  return (
    <>
      <InlineConfirmation source={source} />
      {pending === null && last !== null ? <AppliedBanner decision={last} /> : null}
    </>
  );
}

const meta: Meta<typeof InlineConfirmation> = {
  title: 'Chat/InlineConfirmation',
  component: InlineConfirmation,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Bottom-of-chat tool approval dialog (F17). Card-style with a category accent strip ' +
          '(yellow for write, accent-blue for read), pretty-printed args, and three actions: ' +
          '`Allow once` (primary), `Allow for thread` (outlined), `Deny` (subtle danger). ' +
          'When a request resolves, the dialog disappears; the "After applied" stories show ' +
          'a thin transient banner that hosts can render to confirm the decision was applied.',
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof InlineConfirmation>;

export const HiddenIdle: Story = {
  name: 'Idle · hidden (no pending request)',
  args: { source: staticSource(null) },
};

export const PendingWrite: Story = {
  name: 'Pending · write tool (editNote)',
  args: { source: staticSource(WRITE_REQ, fn()) },
};

export const PendingRead: Story = {
  name: 'Pending · read tool (readFile)',
  args: { source: staticSource(READ_REQ, fn()) },
};

export const PendingLargeArgs: Story = {
  name: 'Pending · long args (scrollable body)',
  args: { source: staticSource(LARGE_REQ, fn()) },
};

export const FocusOnAllowOnce: Story = {
  name: 'Pending · focus lands on Allow once',
  args: { source: staticSource(WRITE_REQ, fn()) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await c.findByRole('dialog');
  },
};

export const KeyboardEscapeDenies: Story = {
  name: 'Pending · Escape resolves as deny',
  args: { source: staticSource(WRITE_REQ, fn()) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await c.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
  },
};

export const AfterAppliedAllowOnce: Story = {
  name: 'After applied · Allow once (auto-resolves)',
  render: () => <AfterAppliedHarness initialRequest={WRITE_REQ} autoDecision="allow-once" />,
  parameters: {
    docs: {
      description: {
        story:
          'Renders the dialog, auto-resolves with `allow-once` after 800ms to demonstrate ' +
          'the post-applied state. Refresh the story to replay.',
      },
    },
  },
};

export const AfterAppliedAllowThread: Story = {
  name: 'After applied · Allow for thread',
  render: () => <AfterAppliedHarness initialRequest={WRITE_REQ} autoDecision="allow-thread" />,
};

export const AfterAppliedDenied: Story = {
  name: 'After applied · Denied',
  render: () => <AfterAppliedHarness initialRequest={WRITE_REQ} autoDecision="deny" />,
};
