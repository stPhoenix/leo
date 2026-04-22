export type AcceptRejectDecision = 'accept' | 'reject';

export interface EditNoteProposal {
  readonly toolId: string;
  readonly path: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly routedVia: 'editor' | 'vault';
  readonly onAccept?: () => void;
  readonly onReject?: () => void;
}

export interface PendingAcceptReject {
  readonly proposal: EditNoteProposal;
  readonly resolve: (decision: AcceptRejectDecision) => void;
}

export type AcceptRejectListener = (pending: PendingAcceptReject | null) => void;

export class AcceptRejectController {
  private pending: PendingAcceptReject | null = null;
  private readonly listeners = new Set<AcceptRejectListener>();

  present(proposal: EditNoteProposal): Promise<AcceptRejectDecision> {
    if (this.pending !== null) {
      this.pending.resolve('accept');
      this.pending = null;
      this.notify();
    }
    return new Promise<AcceptRejectDecision>((resolve) => {
      this.pending = {
        proposal,
        resolve: (decision) => {
          if (this.pending === null) return;
          if (this.pending.proposal !== proposal) return;
          this.pending = null;
          this.notify();
          if (decision === 'accept') proposal.onAccept?.();
          else proposal.onReject?.();
          resolve(decision);
        },
      };
      this.notify();
    });
  }

  resolve(decision: AcceptRejectDecision): void {
    this.pending?.resolve(decision);
  }

  current(): PendingAcceptReject | null {
    return this.pending;
  }

  subscribe(listener: AcceptRejectListener): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.pending !== null) this.pending.resolve('accept');
    this.pending = null;
    this.listeners.clear();
  }

  private notify(): void {
    const snap = this.pending;
    for (const l of this.listeners) l(snap);
  }
}
