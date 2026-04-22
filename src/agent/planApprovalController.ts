export type PlanApprovalOutcome =
  | { readonly type: 'approve'; readonly planWasEdited: false; readonly plan: string }
  | { readonly type: 'edit'; readonly planWasEdited: true; readonly plan: string }
  | { readonly type: 'reject' };

export interface PlanApprovalRequest {
  readonly plan: string;
  readonly threadId: string;
  readonly isSubagent: boolean;
}

export interface PendingPlanApproval {
  readonly request: PlanApprovalRequest;
  readonly resolve: (outcome: PlanApprovalOutcome) => void;
}

export type PlanApprovalListener = (pending: PendingPlanApproval | null) => void;

export class PlanApprovalController {
  private pending: PendingPlanApproval | null = null;
  private readonly listeners = new Set<PlanApprovalListener>();

  present(request: PlanApprovalRequest): Promise<PlanApprovalOutcome> {
    if (this.pending !== null) {
      this.pending.resolve({ type: 'reject' });
      this.pending = null;
      this.notify();
    }
    return new Promise<PlanApprovalOutcome>((resolve) => {
      this.pending = {
        request,
        resolve: (outcome) => {
          if (this.pending === null) return;
          if (this.pending.request !== request) return;
          this.pending = null;
          this.notify();
          resolve(outcome);
        },
      };
      this.notify();
    });
  }

  resolve(outcome: PlanApprovalOutcome): void {
    this.pending?.resolve(outcome);
  }

  current(): PendingPlanApproval | null {
    return this.pending;
  }

  subscribe(listener: PlanApprovalListener): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.pending !== null) this.pending.resolve({ type: 'reject' });
    this.pending = null;
    this.listeners.clear();
  }

  private notify(): void {
    const snap = this.pending;
    for (const l of this.listeners) l(snap);
  }
}
