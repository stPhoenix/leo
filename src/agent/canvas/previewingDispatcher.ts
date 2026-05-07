import type { CanvasState, EditAction, PreviewingDecisionAdapter } from './state';

export class CanvasPreviewingDispatcher implements PreviewingDecisionAdapter {
  private readonly pending = new Map<string, (action: EditAction) => void>();

  awaitDecision(state: CanvasState): Promise<EditAction> {
    return new Promise<EditAction>((resolve) => {
      this.pending.set(state.runId, resolve);
    });
  }

  resolve(runId: string, action: EditAction): boolean {
    const r = this.pending.get(runId);
    if (r === undefined) return false;
    this.pending.delete(runId);
    r(action);
    return true;
  }

  hasPending(runId: string): boolean {
    return this.pending.has(runId);
  }

  clear(): void {
    for (const [runId, resolve] of [...this.pending.entries()]) {
      this.pending.delete(runId);
      resolve({ kind: 'cancel' });
    }
  }
}
