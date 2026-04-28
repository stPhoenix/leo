import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, within, userEvent } from 'storybook/test';
import type {
  PendingPlanApproval,
  PlanApprovalOutcome,
  PlanApprovalRequest,
} from '@/agent/planApprovalController';
import { PlanApprovalDialog, type PlanApprovalSource } from './PlanApprovalDialog';
import { mockRenderPlanMarkdown } from './__stories__/mocks/sources';

function makeStaticSource(
  request: PlanApprovalRequest | null,
  onResolve: (outcome: PlanApprovalOutcome) => void = () => undefined,
): PlanApprovalSource {
  const pending: PendingPlanApproval | null =
    request === null ? null : { request, resolve: onResolve };
  return {
    current: () => pending,
    subscribe: () => () => undefined,
    resolve: onResolve,
  };
}

const SHORT_PLAN = [
  '## Plan',
  '',
  '1. Add `PlanApprovalDialog` story.',
  '2. Wire mock `PlanApprovalSource`.',
  '3. Verify approve/edit/reject buttons.',
].join('\n');

const LONG_PLAN = [
  '## Refactor plan',
  '',
  '### Phase 1 — extract module',
  '- Move `planApprovalController` into `src/agent/plan/`.',
  '- Re-export from existing path for one release.',
  '',
  '### Phase 2 — wire UI',
  '- `PlanApprovalDialog` reads from `PlanApprovalSource`.',
  '- Add focus-trap + Escape-to-reject.',
  '',
  '### Phase 3 — tests',
  '- Cover view/edit/reject paths.',
  '- Subagent short-circuit (case 2).',
  '- Empty-plan short-circuit (case 3).',
  '',
  '```ts',
  'controller.present({ plan, threadId, isSubagent: false });',
  '```',
  '',
  '> Risk: edit textarea loses scroll on confirm.',
].join('\n');

const baseRequest: PlanApprovalRequest = {
  plan: SHORT_PLAN,
  threadId: 't-storybook',
  isSubagent: false,
};

const meta: Meta<typeof PlanApprovalDialog> = {
  title: 'Chat/PlanApprovalDialog',
  component: PlanApprovalDialog,
  args: {
    source: makeStaticSource(baseRequest, fn()),
  },
};
export default meta;

type Story = StoryObj<typeof PlanApprovalDialog>;

export const HiddenWhenNoPending: Story = {
  args: { source: makeStaticSource(null) },
  parameters: {
    docs: {
      description: {
        story: 'No pending approval — dialog renders hidden placeholder div.',
      },
    },
  },
};

export const ViewPlainText: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Pending plan with no markdown renderer; falls back to `<pre>` block.',
      },
    },
  },
};

export const ViewMarkdown: Story = {
  args: {
    source: makeStaticSource(baseRequest, fn()),
    renderMarkdown: mockRenderPlanMarkdown,
  },
};

export const LongPlan: Story = {
  args: {
    source: makeStaticSource({ ...baseRequest, plan: LONG_PLAN }, fn()),
    renderMarkdown: mockRenderPlanMarkdown,
  },
};

export const EditPhase: Story = {
  args: {
    source: makeStaticSource(baseRequest, fn()),
    renderMarkdown: mockRenderPlanMarkdown,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const editBtn = await canvas.findByRole('button', { name: 'Edit' });
    await userEvent.click(editBtn);
  },
};
