import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, within, userEvent } from 'storybook/test';
import { useEffect, useState } from 'react';
import { InlineDialog, type AcceptRejectSource } from './InlineDialog';
import type {
  AcceptRejectDecision,
  EditNoteProposal,
  PendingAcceptReject,
} from '@/agent/acceptRejectController';

const EDITOR_PROPOSAL: EditNoteProposal = {
  toolId: 'edit_note',
  intent: 'edit',
  path: 'Hello.md',
  lineStart: 4,
  lineEnd: 4,
  routedVia: 'editor',
};

const VAULT_PROPOSAL: EditNoteProposal = {
  toolId: 'edit_note',
  intent: 'edit',
  path: 'docs/runbook.md',
  lineStart: 12,
  lineEnd: 38,
  routedVia: 'vault',
};

function staticSource(
  proposal: EditNoteProposal | null,
  onResolve: (d: AcceptRejectDecision) => void = () => undefined,
): AcceptRejectSource {
  const pending: PendingAcceptReject | null =
    proposal === null ? null : { proposal, resolve: onResolve };
  return {
    current: () => pending,
    subscribe: () => () => undefined,
    resolve: onResolve,
  };
}

interface AppliedBannerProps {
  readonly decision: AcceptRejectDecision;
  readonly proposal: EditNoteProposal;
}

function AppliedBanner(props: AppliedBannerProps): JSX.Element {
  const accepted = props.decision === 'accept';
  return (
    <div
      data-region="dialog-applied"
      data-decision={props.decision}
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
        color: accepted ? 'var(--text-muted)' : 'var(--text-error)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: accepted
            ? 'var(--color-green, var(--interactive-accent))'
            : 'var(--text-error)',
        }}
      />
      {accepted
        ? `Edit accepted — ${props.proposal.path} L${props.proposal.lineStart}–L${props.proposal.lineEnd} applied`
        : `Edit rejected — ${props.proposal.path} reverted`}
    </div>
  );
}

function AfterAppliedHarness(props: {
  readonly proposal: EditNoteProposal;
  readonly autoResolveAfterMs?: number;
  readonly autoDecision?: AcceptRejectDecision;
}): JSX.Element {
  const { proposal, autoResolveAfterMs = 800, autoDecision = 'accept' } = props;
  const [pending, setPending] = useState<PendingAcceptReject | null>({
    proposal,
    resolve: () => undefined,
  });
  const [last, setLast] = useState<AcceptRejectDecision | null>(null);

  useEffect(() => {
    if (pending === null) return;
    const t = setTimeout(() => {
      setLast(autoDecision);
      setPending(null);
    }, autoResolveAfterMs);
    return () => clearTimeout(t);
  }, [pending, autoResolveAfterMs, autoDecision]);

  const source: AcceptRejectSource = {
    current: () => pending,
    subscribe: () => () => undefined,
    resolve: (d) => {
      setLast(d);
      setPending(null);
    },
  };

  return (
    <>
      <InlineDialog source={source} />
      {pending === null && last !== null ? (
        <AppliedBanner decision={last} proposal={proposal} />
      ) : null}
    </>
  );
}

const meta: Meta<typeof InlineDialog> = {
  title: 'Chat/InlineDialog',
  component: InlineDialog,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Bottom-of-chat Accept/Reject review for edit-note proposals. Card-style with a yellow ' +
          'accent strip and a primary `Accept` / danger `Reject` action pair. Routed via the ' +
          'active editor (live, undoable) or the vault adapter (file-only).',
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof InlineDialog>;

export const HiddenIdle: Story = {
  name: 'Idle · hidden (no pending proposal)',
  args: { source: staticSource(null) },
};

export const PendingEditorEdit: Story = {
  name: 'Pending · routed via editor (Hello.md L4)',
  args: { source: staticSource(EDITOR_PROPOSAL, fn()) },
};

export const PendingVaultEdit: Story = {
  name: 'Pending · routed via vault (multi-line)',
  args: { source: staticSource(VAULT_PROPOSAL, fn()) },
};

export const KeyboardFlow: Story = {
  name: 'Pending · keyboard tab + accept',
  args: { source: staticSource(EDITOR_PROPOSAL, fn()) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const accept = await c.findByRole('button', { name: 'Accept edit' });
    accept.focus();
    await userEvent.keyboard('{Tab}');
  },
};

export const AfterAppliedAccepted: Story = {
  name: 'After applied · Accepted (auto-resolves)',
  render: () => <AfterAppliedHarness proposal={EDITOR_PROPOSAL} autoDecision="accept" />,
  parameters: {
    docs: {
      description: {
        story:
          'Renders the dialog, auto-resolves with `accept` after 800ms to demonstrate the ' +
          'post-applied state. The dialog disappears; a thin banner confirms the edit was applied.',
      },
    },
  },
};

export const AfterAppliedRejected: Story = {
  name: 'After applied · Rejected (auto-resolves)',
  render: () => <AfterAppliedHarness proposal={EDITOR_PROPOSAL} autoDecision="reject" />,
};
