import type { AcceptRejectController, EditNoteProposal } from '@/agent/acceptRejectController';
import type { Logger } from '@/platform/Logger';

export interface PresentDecisionInput {
  readonly acceptReject: AcceptRejectController;
  readonly proposal: EditNoteProposal;
  readonly logger?: Logger;
  readonly logKey: string;
  readonly logFields: Record<string, unknown>;
  readonly revert: () => Promise<void>;
  readonly revertFailureLevel?: 'warn' | 'error';
  readonly revertFailureSuffix?: string;
}

export interface PresentDecisionResult {
  readonly reverted: boolean;
}

export async function presentDecision(input: PresentDecisionInput): Promise<PresentDecisionResult> {
  const decision = await input.acceptReject.present(input.proposal);
  if (decision !== 'reject') {
    input.logger?.info(`${input.logKey}.accept`, input.logFields);
    return { reverted: false };
  }
  try {
    await input.revert();
    input.logger?.info(`${input.logKey}.reject`, input.logFields);
    return { reverted: true };
  } catch (err) {
    const level = input.revertFailureLevel ?? 'error';
    const suffix = input.revertFailureSuffix ?? '.reject.failed';
    const fields = {
      ...input.logFields,
      error: err instanceof Error ? err.message : String(err),
    };
    if (level === 'warn') input.logger?.warn(`${input.logKey}${suffix}`, fields);
    else input.logger?.error(`${input.logKey}${suffix}`, fields);
    return { reverted: false };
  }
}
