export interface ClarifyingQuestionRequest {
  readonly threadId: string;
  readonly question: string;
  readonly header?: string;
  readonly options?: readonly string[];
  readonly multiSelect?: boolean;
}

export type ClarifyingQuestionOutcome =
  | { readonly type: 'answer'; readonly answer: string }
  | { readonly type: 'answerMulti'; readonly answers: readonly string[] }
  | { readonly type: 'cancel' };

export interface PendingClarifyingQuestion {
  readonly request: ClarifyingQuestionRequest;
  readonly resolve: (outcome: ClarifyingQuestionOutcome) => void;
}

export type ClarifyingQuestionListener = (pending: PendingClarifyingQuestion | null) => void;

export class ClarifyingQuestionController {
  private pending: PendingClarifyingQuestion | null = null;
  private readonly listeners = new Set<ClarifyingQuestionListener>();

  present(request: ClarifyingQuestionRequest): Promise<ClarifyingQuestionOutcome> {
    if (this.pending !== null) {
      this.pending.resolve({ type: 'cancel' });
      this.pending = null;
      this.notify();
    }
    return new Promise<ClarifyingQuestionOutcome>((resolve) => {
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

  resolve(outcome: ClarifyingQuestionOutcome): void {
    this.pending?.resolve(outcome);
  }

  current(): PendingClarifyingQuestion | null {
    return this.pending;
  }

  subscribe(listener: ClarifyingQuestionListener): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.pending !== null) this.pending.resolve({ type: 'cancel' });
    this.pending = null;
    this.listeners.clear();
  }

  private notify(): void {
    const snap = this.pending;
    for (const l of this.listeners) l(snap);
  }
}
