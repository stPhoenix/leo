import type { Meta, StoryObj } from '@storybook/react-vite';
import { PiiReviewBanner } from './PiiReviewBanner';
import type { PiiDecision } from '@/agent/externalAgent/applyPiiDecisions';
import type { PiiFinding } from '@/agent/externalAgent/piiDetectAgent';

const meta: Meta<typeof PiiReviewBanner> = {
  title: 'Chat/Blocks/PiiReviewBanner',
  component: PiiReviewBanner,
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof PiiReviewBanner>;

const sampleFindings: readonly PiiFinding[] = [
  {
    id: 'email-1',
    kind: 'email',
    start: 0,
    end: 20,
    sample: 'j*******e@e*****e.com',
    suggestion: 'mask',
  },
  {
    id: 'apikey-1',
    kind: 'apiKey',
    start: 21,
    end: 41,
    sample: 'A******************E',
    suggestion: 'remove',
  },
  {
    id: 'phone-1',
    kind: 'phone',
    start: 42,
    end: 58,
    sample: '+*************67',
    suggestion: 'mask',
  },
];

const otherFinding: PiiFinding = {
  id: 'other-1',
  kind: 'other',
  start: 0,
  end: 8,
  sample: 'A******t',
  suggestion: 'remove',
  note: 'home address inferred from city + street',
};

export const Scanning: Story = {
  args: {
    status: 'scanning',
    findings: [],
    decisions: new Map(),
    onDecide: () => undefined,
    onApplyAll: () => undefined,
    onIgnoreAll: () => undefined,
  },
};

export const ReadyNoFindings: Story = {
  args: {
    status: 'ready',
    findings: [],
    decisions: new Map(),
    onDecide: () => undefined,
    onApplyAll: () => undefined,
    onIgnoreAll: () => undefined,
  },
};

export const ReadyAllPending: Story = {
  args: {
    status: 'ready',
    findings: sampleFindings,
    decisions: new Map(),
    onDecide: () => undefined,
    onApplyAll: () => undefined,
    onIgnoreAll: () => undefined,
  },
};

export const ReadyMixedDecisions: Story = {
  args: {
    status: 'ready',
    findings: sampleFindings,
    decisions: new Map<string, PiiDecision>([
      ['email-1', 'mask'],
      ['apikey-1', 'remove'],
    ]),
    onDecide: () => undefined,
    onApplyAll: () => undefined,
    onIgnoreAll: () => undefined,
  },
};

export const ReadyAllIgnored: Story = {
  args: {
    status: 'ready',
    findings: sampleFindings,
    decisions: new Map<string, PiiDecision>([
      ['email-1', 'ignore'],
      ['apikey-1', 'ignore'],
      ['phone-1', 'ignore'],
    ]),
    onDecide: () => undefined,
    onApplyAll: () => undefined,
    onIgnoreAll: () => undefined,
  },
};

export const ReadyOtherKindWithNote: Story = {
  args: {
    status: 'ready',
    findings: [otherFinding],
    decisions: new Map(),
    onDecide: () => undefined,
    onApplyAll: () => undefined,
    onIgnoreAll: () => undefined,
  },
};

export const ErrorWithRetry: Story = {
  args: {
    status: 'error',
    findings: [],
    decisions: new Map(),
    errorMessage: 'provider unavailable (LM Studio not reachable)',
    onDecide: () => undefined,
    onApplyAll: () => undefined,
    onIgnoreAll: () => undefined,
    onRetry: () => undefined,
  },
};
